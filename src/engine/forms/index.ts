/**
 * AcroForm engine — field types, appearance synthesis, flattening, detection.
 */

export {
  buildAppearanceStream,
  appearanceToPageContent,
  parseWidgetRect,
  flattenField,
  flattenWidgets,
} from './flatten-field';

export {
  parseAcroFormCatalog,
  detectFormFieldsOnPage,
  listAllFormWidgets,
} from './detect-fields';

export {
  setFormFieldValue,
  flattenFormFieldsOnPage,
  removeWidgetAnnots,
} from './apply-field';

export type {
  AcroFormFieldType,
  ButtonStyle,
  AcroFormWidget,
  AcroFormCatalog,
  AcroFormField,
  AppearanceVariant,
  AppearanceStream,
  FlattenFieldResult,
  FlattenFieldOptions,
} from './types';

export { DEFAULT_FLATTEN_OPTIONS } from './types';
