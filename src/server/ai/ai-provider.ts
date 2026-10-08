export type AIAnalysis = {
  label: string;
  confidence: number | null;
};

export type AIImageInput = {
  eventId: string;
  classification: string | null;
};

export interface AIProvider {
  readonly name: string;
  analyzeImage(input: AIImageInput): Promise<AIAnalysis | null>;
}

export class DisabledAIProvider implements AIProvider {
  readonly name = "disabled";

  async analyzeImage(): Promise<AIAnalysis | null> {
    return null;
  }
}

/** Records the DVR's own label. It does not run a vision model and does not invent a confidence score. */
export class DVRClassificationProvider implements AIProvider {
  readonly name = "dvr";

  async analyzeImage(input: AIImageInput): Promise<AIAnalysis | null> {
    if (input.classification !== "person" && input.classification !== "vehicle") return null;
    return { label: input.classification, confidence: null };
  }
}

export function createAIProvider(enabled: boolean): AIProvider {
  return enabled ? new DVRClassificationProvider() : new DisabledAIProvider();
}
