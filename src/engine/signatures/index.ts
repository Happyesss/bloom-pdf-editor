/**
 * Digital signatures — ASN.1 DER, PKCS#7/CMS, digest verification, signing.
 * Visual signatures — overlay placement, library, draw/import/typed, appearances.
 * Signature fields (Phase 4) + appearance streams (Phase 5).
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
  signDocumentWithResult,
  signDocumentCryptographic,
  createSignatureDictionary,
} from './sign';
export type { SignOptions, CryptoSignOptions, SignPipelineResult } from './sign';

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

// ── Visual signatures (Phases 1–3) ──

export type {
  SignatureAppearanceType,
  VisualSignature,
  SignatureSourceKind,
  SignatureLibraryEntry,
  StrokePoint,
  Stroke,
  DrawEngineOptions,
  AppearanceTextComponent,
  AppearanceImageComponent,
  AppearanceBackgroundComponent,
  AppearanceBorderComponent,
  SignatureAppearanceLayout,
  SignatureAppearance,
  AppearanceRenderOptions,
  AppearanceRenderResult,
} from './visual-types';

export {
  DEFAULT_SIGNATURE_SIZE,
  TYPED_SIGNATURE_FONTS,
} from './visual-types';

export {
  nextSignatureId,
  resetSignatureIdCounter,
  createVisualSignature,
  cloneVisualSignature,
  hitTestSignature,
  moveSignature,
  resizeSignature,
  rotateSignature,
  setSignatureOpacity,
  setSignatureLocked,
  deleteSignature,
  updateSignature,
  signatureToBBox,
} from './signature-model';
export type { CreateSignatureOpts } from './signature-model';

export { SignatureHistory } from './visual-history';
export type { SignatureSnapshot } from './visual-history';

export {
  SignatureDrawEngine,
  paintStroke,
  strokeToPathD,
} from './draw-engine';

export {
  isAllowedSignatureFile,
  importSignatureFile,
  importSvgString,
  importDataURL,
} from './import-engine';
export type { ImportMime, ImportedSignature } from './import-engine';

export {
  listTypedSignatureFonts,
  renderTypedSignature,
  typedSignatureToSVG,
} from './typed-engine';
export type { TypedSignatureOptions, TypedSignatureResult } from './typed-engine';

export {
  SignatureLibrary,
  getSignatureLibrary,
  resetSignatureLibraryForTests,
} from './library';

export {
  buildSignatureAppearance,
  cloneAppearance,
  setAppearanceComponentVisible,
  updateAppearanceLayout,
  listAppearanceTemplates,
  getAppearanceTemplate,
} from './appearance-builder';
export type { BuildAppearanceInput } from './appearance-builder';

export type { AppearanceTemplate } from './appearance-templates';

export {
  renderSignatureAppearance,
  buildAppearanceSVG,
  rasterizeAppearanceAsync,
} from './appearance-renderer';

// ── Phase 4 — Signature fields ──

export type {
  SignatureField,
  CreateSignatureFieldOptions,
} from './signature-field';

export {
  pageIndexForWidget,
  widgetToSignatureField,
  listSignatureFields,
  detectSignatureFieldsOnPage,
  hitTestSignatureField,
  lookupSignatureFieldByName,
  lookupSignatureFieldByRef,
  createSignatureFieldAtPoint,
  placeSignatureInField,
  hitTestAnyFormOrSignatureField,
  ensureAcroFormCatalog,
} from './signature-field';

// ── Phase 5 — Appearance streams ──

export {
  AppearanceResourceManager,
  buildSignatureAppearanceContent,
  serializeAppearanceStream,
  attachNormalAppearance,
  embedAppearanceImage,
  dataUrlToJpegBytes,
  applySignatureFieldAppearance,
  applySignatureFieldAppearanceAsync,
  getNormalAppearanceRef,
} from './appearance-stream';
export type {
  SignatureFieldAppearanceOptions,
  SerializedAppearance,
} from './appearance-stream';

// ── Phase 7 — Hash / CMS / signing pipeline ──

export {
  hashBytes,
  hashByteRanges,
  bytesToHex,
  hexToBytes,
  toSubtleHashName,
  hashAlgorithmOID,
  hashDigestLength,
  HASH_ALGORITHMS,
} from './hash-engine';
export type { HashAlgorithm } from './hash-engine';

export {
  buildDetachedCMSAdvanced,
  getSignedAttributesForSigning,
  derLength,
  derSequence,
  derSet,
  derOctetString,
  derInteger,
  derObjectIdentifier,
} from './cms-builder';
export type { BuildCMSOptions, SignatureAlgorithmKind } from './cms-builder';

export {
  makeContentsPlaceholder,
  computeDocumentDigest,
  calculateByteRange,
  validateByteRange,
  hashExcludedContents,
  findContentsHexSpan,
  computeByteRangeFromContentsSpan,
  injectSignature,
  injectSignatureContents,
  fillContentsHex,
  patchByteRangeInPlace,
  finalizePdfSignature,
  DEFAULT_CONTENTS_SIZE,
  BYTERANGE_DIGIT_WIDTH,
} from './signing-pipeline';

export type { ByteRange, ContentsSpan, ByteRangeCalculation } from './byterange';
export type { FinalizeSignatureResult, FinalizeSignatureInput } from './finalizer';

// ── Phase 9 — Certificates ──

export {
  decodePem,
  isPem,
  parseCertificateDer,
  importPrivateKey,
  importFromPem,
  importCertificateDer,
  formatCertificateSummary,
  isCertificateExpired,
} from './certificate-parser';
export type {
  CertificateFormat,
  DistinguishedName,
  CertificateInfo,
  ImportedKeyMaterial,
  ImportedCertificateBundle,
} from './certificate-parser';

export {
  importPkcs12,
  detectCertificateFileFormat,
} from './pkcs12';

export {
  CertificateManager,
  getCertificateManager,
  resetCertificateManagerForTests,
} from './certificate-manager';
export type { ManagedIdentity } from './certificate-manager';

// ── Phase 10 — Validation ──

export {
  trimCmsPadding,
  extractPdfSignatureDict,
  extractSpkiFromCertificate,
  verifyCmsCryptographic,
  validateSignatureField,
  validateDocumentSignatures,
  validationStatusBadge,
} from './validation-engine';
export type {
  ValidationStatus,
  TrustAnchor,
  ValidationOptions,
  CertificateValidationInfo,
  SignatureValidationDetail,
  ValidationReport,
} from './validation-types';

// ── Phase 11 — Timestamps ──

export {
  buildTimestampRequest,
  parseTimestampResponse,
  requestTimestamp,
  cmsHasTimestampToken,
  DEFAULT_TSA_URLS,
} from './timestamp-parser';
export type {
  TimestampRequestOptions,
  TimestampToken,
  TimestampResult,
} from './timestamp-parser';

// ── Phase 12 — Multi-signature ──

export {
  listManagedSignatures,
  buildRevisionViewer,
  inspectMultiSignatures,
  canAddSignatureWithoutInvalidating,
} from './multi-signature-manager';
export type {
  ManagedSignature,
  RevisionViewEntry,
  MultiSignatureSnapshot,
} from './multi-signature-manager';

// ── Phase 13 — LTV / DSS ──

export {
  buildDocumentSecurityStore,
  embedDssIncremental,
  readDssSummary,
} from './dss-builder';
export type { DssBuildInput, DssBuildResult } from './dss-builder';

export {
  collectEmbeddedCertificates,
  enableLongTermValidation,
  getLtvStatus,
  fetchOcspPlaceholder,
} from './ltv-engine';
export type { LtvEnableOptions, LtvStatus } from './ltv-engine';

// ── Phase 14 — UX helpers ──

export {
  SIGNATURE_SHORTCUTS,
  pushRecentSignatureId,
  listRecentSignatureIds,
  orderLibraryByRecent,
  lockSignaturesAfterSigning,
  snapToAlignmentGuides,
  defaultPageGuides,
} from './ux-helpers';
