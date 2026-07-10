/**
 * Digital signatures — ASN.1 DER, PKCS#7/CMS, digest verification, signing.
 */

export {
  parseDERNode,
  parseDER,
  parseCMSSignedData,
  computeByteRangeDigest,
  verifySignatureDigest,
  decodeOID,
  nodeOID,
  parseContentInfo,
} from './signature-verify';

export {
  buildDetachedCMS,
  createSignatureField,
  signDocument,
} from './sign';
export type { SignOptions } from './sign';

export type {
  ASN1Class,
  ASN1Node,
  PKCS7ContentInfo,
  CMSSignedData,
  CMSSignerInfo,
  PDFSignatureDict,
  SignatureVerificationResult,
  VerifyDigestOptions,
} from './types';

export { DEFAULT_VERIFY_OPTIONS, OID, OID_TO_DIGEST } from './types';
