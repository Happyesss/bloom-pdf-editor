/**
 * Digital signing — create signature fields and sign with Web Crypto.
 * Produces a minimal CMS/PKCS#7 detached signature structure in pure TypeScript.
 */

import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFDocumentData,
  type PDFRectangle,
} from '../types';
import { getNextObjNum } from '../writer/serializer';
import { addAnnotationToPage } from '../editor/annotation-engine';
import { flateEncode } from '../parser/filters';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Minimal DER length encoding. */
function derLength(len: number): number[] {
  if (len < 0x80) return [len];
  if (len < 0x100) return [0x81, len];
  return [0x82, (len >> 8) & 0xff, len & 0xff];
}

function derSequence(contents: number[]): number[] {
  return [0x30, ...derLength(contents.length), ...contents];
}

function derOctetString(data: Uint8Array | number[]): number[] {
  const arr = Array.from(data);
  return [0x04, ...derLength(arr.length), ...arr];
}

function derObjectIdentifier(oid: number[]): number[] {
  // Simplified: encode first two combined, then base-128
  if (oid.length < 2) return [0x06, 0x01, 0x00];
  const body: number[] = [oid[0] * 40 + oid[1]];
  for (let i = 2; i < oid.length; i++) {
    let v = oid[i];
    const stack: number[] = [];
    stack.push(v & 0x7f);
    v >>= 7;
    while (v > 0) {
      stack.push(0x80 | (v & 0x7f));
      v >>= 7;
    }
    for (let j = stack.length - 1; j >= 0; j--) body.push(stack[j]);
  }
  return [0x06, ...derLength(body.length), ...body];
}

/**
 * Build a minimal detached CMS SignedData structure wrapping a digest + signature.
 * Not a full PKI implementation — sufficient for round-trip testing and Acrobat recognition of /Contents.
 */
export function buildDetachedCMS(
  digest: Uint8Array,
  signature: Uint8Array,
  certDer?: Uint8Array,
): Uint8Array {
  // digestAlgorithm SHA-256 OID 2.16.840.1.101.3.4.2.1
  const sha256Oid = derObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 1]);
  const digestAlg = derSequence([...sha256Oid, 0x05, 0x00]);

  // rsaEncryption OID 1.2.840.113549.1.1.1 for sig alg (or ecPublicKey)
  const rsaOid = derObjectIdentifier([1, 2, 840, 113549, 1, 1, 1]);
  const sigAlg = derSequence([...rsaOid, 0x05, 0x00]);

  const encDigest = derOctetString(signature);

  const signerInfo = derSequence([
    0x02, 0x01, 0x01, // version
    ...derSequence([0x02, 0x01, 0x00]), // issuerAndSerialNumber placeholder
    ...digestAlg,
    ...sigAlg,
    ...encDigest,
  ]);

  const digestAlgs = derSequence(digestAlg);
  const signerInfos = derSequence(signerInfo);

  // eContent empty for detached
  const encapContent = derSequence([
    ...derObjectIdentifier([1, 2, 840, 113549, 1, 7, 1]), // data
  ]);

  const signedDataBody: number[] = [
    0x02, 0x01, 0x01, // version
    ...digestAlgs,
    ...encapContent,
  ];

  if (certDer && certDer.length > 0) {
    // certificates [0] IMPLICIT
    const certs = [0xa0, ...derLength(certDer.length), ...Array.from(certDer)];
    signedDataBody.push(...certs);
  }

  signedDataBody.push(...signerInfos);
  const signedData = derSequence(signedDataBody);

  // ContentInfo
  const contentInfo = derSequence([
    ...derObjectIdentifier([1, 2, 840, 113549, 1, 7, 2]), // signedData
    0xa0, ...derLength(signedData.length), ...signedData,
  ]);

  // Keep digest referenced so callers can verify locally
  void digest;

  return new Uint8Array(contentInfo);
}

/** Create an empty signature field widget on a page. */
export function createSignatureField(
  doc: PDFDocumentData,
  pageIndex: number,
  rect: PDFRectangle,
  fieldName = 'Signature1',
): PDFRef {
  const page = doc.pages[pageIndex];
  const objNum = getNextObjNum(doc);
  const ref = new PDFRef(objNum, 0);

  const dict = new PDFDict();
  dict.set('Type', new PDFName('Annot'));
  dict.set('Subtype', new PDFName('Widget'));
  dict.set('FT', new PDFName('Sig'));
  dict.set('T', new PDFString(fieldName));
  dict.set('Rect', new PDFArray([
    new PDFNumber(rect.x),
    new PDFNumber(rect.y),
    new PDFNumber(rect.x + rect.width),
    new PDFNumber(rect.y + rect.height),
  ]));
  dict.set('F', new PDFNumber(4));
  dict.set('P', page.ref);

  addAnnotationToPage(page.dict, dict, ref, doc.objects);

  // Ensure AcroForm
  const catalog = doc.catalog;
  let acro = catalog.get('AcroForm');
  if (!acro) {
    const acroDict = new PDFDict();
    acroDict.set('Fields', new PDFArray([ref]));
    acroDict.set('SigFlags', new PDFNumber(3));
    const acroRef = new PDFRef(getNextObjNum(doc), 0);
    doc.objects.set(acroRef.toKey(), acroDict);
    catalog.set('AcroForm', acroRef);
  } else if (acro instanceof PDFDict) {
    const fields = acro.get('Fields');
    if (fields instanceof PDFArray) fields.push(ref);
  } else if (acro instanceof PDFRef) {
    const acroDict = doc.objects.get(acro.toKey());
    if (acroDict instanceof PDFDict) {
      const fields = acroDict.get('Fields');
      if (fields instanceof PDFArray) fields.push(ref);
      else acroDict.set('Fields', new PDFArray([ref]));
    }
  }

  return ref;
}

export interface SignOptions {
  reason?: string;
  location?: string;
  name?: string;
  appearanceText?: string;
}

/**
 * Sign a signature field using Web Crypto (RSA-PSS or ECDSA).
 * Places a placeholder ByteRange and CMS Contents on the field.
 */
export async function signDocument(
  doc: PDFDocumentData,
  fieldRef: PDFRef,
  privateKey: CryptoKey,
  certDer?: Uint8Array,
  options: SignOptions = {},
): Promise<PDFDocumentData> {
  const field = doc.objects.get(fieldRef.toKey());
  if (!(field instanceof PDFDict)) {
    throw new Error('Signature field not found');
  }

  // Digest document raw bytes (or empty placeholder)
  const data = doc.rawBytes ?? new Uint8Array(0);
  const digestBuf = await crypto.subtle.digest('SHA-256', data.slice().buffer as ArrayBuffer);
  const digest = new Uint8Array(digestBuf);

  const signatureBuf = await crypto.subtle.sign(
    privateKey.algorithm.name === 'ECDSA'
      ? { name: 'ECDSA', hash: 'SHA-256' }
      : { name: 'RSA-PSS', saltLength: 32 },
    privateKey,
    digest,
  );
  const signature = new Uint8Array(signatureBuf);
  const cms = buildDetachedCMS(digest, signature, certDer);

  // Pad Contents to fixed size for ByteRange updates
  const contentsSize = Math.max(cms.length, 8192);
  const padded = new Uint8Array(contentsSize);
  padded.set(cms);

  const sigDict = new PDFDict();
  sigDict.set('Type', new PDFName('Sig'));
  sigDict.set('Filter', new PDFName('Adobe.PPKLite'));
  sigDict.set('SubFilter', new PDFName('adbe.pkcs7.detached'));
  sigDict.set('Contents', new PDFHexString(bytesToHex(padded)));
  // ByteRange placeholder — filled properly by incremental writer in production
  sigDict.set('ByteRange', new PDFArray([
    new PDFNumber(0),
    new PDFNumber(0),
    new PDFNumber(0),
    new PDFNumber(0),
  ]));
  if (options.reason) sigDict.set('Reason', new PDFString(options.reason));
  if (options.location) sigDict.set('Location', new PDFString(options.location));
  if (options.name) sigDict.set('Name', new PDFString(options.name));
  sigDict.set('M', new PDFString(`D:${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}+00'00'`));

  const sigRef = new PDFRef(getNextObjNum(doc), 0);
  doc.objects.set(sigRef.toKey(), sigDict);
  field.set('V', sigRef);

  // Simple appearance
  if (options.appearanceText) {
    const text = options.appearanceText;
    const streamContent = `BT /Helv 10 Tf 5 20 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    const bytes = new TextEncoder().encode(streamContent);
    const apDict = new PDFDict();
    apDict.set('Type', new PDFName('XObject'));
    apDict.set('Subtype', new PDFName('Form'));
    apDict.set('BBox', new PDFArray([
      new PDFNumber(0), new PDFNumber(0), new PDFNumber(200), new PDFNumber(50),
    ]));
    apDict.set('Length', new PDFNumber(bytes.length));
    const apStream = new PDFStream(apDict, bytes, bytes);
    const apRef = new PDFRef(getNextObjNum(doc), 0);
    doc.objects.set(apRef.toKey(), apStream);
    const ap = new PDFDict();
    ap.set('N', apRef);
    field.set('AP', ap);
  }

  return doc;
}

void flateEncode; // available for compressed appearances later
