import { BookmarkBuilder } from '../bookmarks.js';
import { FootnoteDetector } from '../footnotes.js';
import { RunningRegionDetector } from '../headers.js';
import { HyperlinkAnalyzer } from '../hyperlinks.js';
import { PageNumberDetector } from '../page-numbers.js';
import { SectionHierarchyBuilder } from '../sections.js';
import { TocDetector } from '../toc.js';
import type { StructureStrategies } from './types.js';

export function createDefaultStructureStrategies(): StructureStrategies {
  return {
    running: new RunningRegionDetector(),
    pageNumbers: new PageNumberDetector(),
    footnotes: new FootnoteDetector(),
    toc: new TocDetector(),
    bookmarks: new BookmarkBuilder(),
    hyperlinks: new HyperlinkAnalyzer(),
    sections: new SectionHierarchyBuilder(),
  };
}
