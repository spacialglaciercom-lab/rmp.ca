export interface RagDocument {
  id: string;
  filename: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: {
    title?: string;
    category?: string;
    ingestedAt: string;
    charCount: number;
  };
}

export interface RagIndexFile {
  version: number;
  documents: RagDocument[];
  lastUpdated: string;
}

export interface RetrievedChunk {
  content: string;
  filename: string;
  score: number;
  category?: string;
}
