# Digital Signatures Engine (Phase 10)

ASN.1 DER parsing, PKCS#7/CMS SignedData extraction, and PDF byte-range digest verification.

## Problem

PDF digital signatures embed PKCS#7 blobs in `/Contents` with `/ByteRange` arrays hashing everything except the signature hex string. Verification requires BER/DER parsing and cryptographic digest comparison.

## Architecture

```
PDF /Sig dictionary
  → signature-verify.ts
       parseDER() / parseCMSSignedData()
       computeByteRangeDigest()   — hash gap-separated ranges
       verifySignatureDigest()    — compare messageDigest signed attr
  → (future) certificate chain, RSA/ECDSA, PAdES, TSA
```

## Standards

| Standard | Scope |
|----------|-------|
| ISO 32000-2 §12.8 | Signature dictionaries, ByteRange |
| RFC 5652 | CMS SignedData |
| RFC 2315 | PKCS#7 (legacy) |
| ETSI EN 319 142 | PAdES (future) |

## ASN.1 DER Reader

Implements definite-length BER/DER subset:

1. Read tag byte → class, constructed, tag number (incl. multi-byte tags)
2. Read length (short or long form)
3. Primitive → content slice
4. Constructed → recursive child parse until content end

**Complexity:** O(n) over input bytes.

**Memory:** O(n) for tree nodes referencing slices.

### Tag classes

| Bits 7–6 | Class |
|----------|-------|
| 00 | universal |
| 01 | application |
| 10 | context-specific |
| 11 | private |

## PKCS#7 / CMS Types

```
ContentInfo ::= SEQUENCE {
  contentType OBJECT IDENTIFIER,
  content [0] EXPLICIT ANY
}

SignedData ::= SEQUENCE {
  version INTEGER,
  digestAlgorithms SET OF AlgorithmIdentifier,
  encapContentInfo ContentInfo,
  certificates [0] IMPLICIT ...,
  signerInfos SET OF SignerInfo
}
```

`parseCMSSignedData()` returns `CMSSignedData` with signer digest algorithm OID and optional signed attributes.

## Byte Range Digest

PDF signature `/ByteRange` = `[offset1, length1, offset2, length2]`:

\[
\text{digest} = \text{Hash}(bytes[offset1 : offset1+length1] \parallel bytes[offset2 : offset2+length2])
\]

The gap covers the `/Contents` hex placeholder.

Uses **Web Crypto** (`crypto.subtle.digest`) in browser; **Node `crypto.createHash`** in API routes.

## verifySignatureDigest()

1. Parse `/Contents` as CMS SignedData
2. Read `messageDigest` signed attribute (OID 1.2.840.113549.1.9.4)
3. Compute byte-range digest with signer’s digest algorithm
4. Compare hex strings

Returns `SignatureVerificationResult` with `digestMatch` and diagnostic errors.

**Note:** RSA/ECDSA signature verification and certificate path validation are Phase 10.2 — this module validates document integrity via message digest only.

## Gap Analysis vs Adobe Acrobat

| Feature | Acrobat | This engine |
|---------|---------|-------------|
| ByteRange digest check | Yes | Yes |
| CMS parsing | Full | SignedData + SignerInfo subset |
| Certificate validation | Full trust store | Not yet |
| RSA/ECDSA verify | Yes | Not yet |
| PAdES-LT | Yes | Not yet |
| Timestamp (TSA) | Yes | Not yet |
| Incremental signing | Yes | Digest only on current bytes |

## Edge Cases

- Indefinite length BER → unsupported (throws)
- Empty `/Contents` → parse error
- Missing signed attrs → digestMatch defaults true (byte-range only mode)
- Multiple SignerInfo → uses first signer

## Testing Strategy

- Known DER INTEGER/OID/SEQUENCE fixtures
- Synthetic PDF with fixed ByteRange + precomputed CMS messageDigest
- Invalid gap ordering → error recorded

## OID Reference

| OID | Meaning |
|-----|---------|
| 1.2.840.113549.1.7.2 | signedData |
| 2.16.840.1.101.3.4.2.1 | sha256 |
| 1.2.840.113549.1.9.4 | messageDigest |
