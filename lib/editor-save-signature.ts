type EditorSaveSignatureInput = {
  id: string;
  title: string;
  description: string;
  slug: string;
  content: string;
  published: boolean;
  password: string;
  usePassword: boolean;
  layout: string | null;
  selectedTermsByTaxonomy: Record<string, number[]>;
  categoryIds: number[];
  tagIds: number[];
  taxonomyIds: number[];
  metaEntries: Array<{ key: string; value: string }>;
};

export function buildEditorSaveSignature(input: EditorSaveSignatureInput) {
  return JSON.stringify({
    id: input.id,
    title: input.title,
    description: input.description,
    slug: input.slug,
    content: input.content,
    published: input.published,
    password: input.password,
    usePassword: input.usePassword,
    layout: input.layout,
    selectedTermsByTaxonomy: input.selectedTermsByTaxonomy,
    categoryIds: input.categoryIds,
    tagIds: input.tagIds,
    taxonomyIds: input.taxonomyIds,
    metaEntries: input.metaEntries,
  });
}
