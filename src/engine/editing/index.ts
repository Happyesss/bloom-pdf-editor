export { QuadTree, hitTestSpatial } from './spatial-index';
export { TransactionStack } from './transactions';
export { buildDisplayListIndex, hitTestDisplayList } from './selection';
export { buildSceneGraph, hitTestScene, resetSceneIdCounter } from './scene-graph';
export type { EditableObject } from './scene-graph';
export {
  identityAffine,
  multiplyAffine,
  invertAffine,
  transformPoint,
  composeTransform,
  transformObject,
  snapToGuides,
} from './transform-editor';
export type {
  Affine,
  ComposeOps,
  ObjectTransformOps,
  Guide,
  SnapGuide,
} from './transform-editor';
export {
  buildPageGuides,
  buildObjectGuides,
  buildAllGuides,
  pageGuides,
  objectGuides,
  allGuides,
} from './snap-guides';
export type { Bounds, SpatialEntry } from './spatial-index';
export type { EditSnapshot } from './transactions';
export type { SelectableItem } from './selection';
