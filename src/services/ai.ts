import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface DetectionResult {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

export async function detectRoadDamage(base64Image: string): Promise<DetectionResult> {
  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    config: {
      responseMimeType: "application/json",
      systemInstruction: "You are an expert civil engineer specializing in road maintenance. Analyze the provided image of a road and detect any damage like potholes, cracks, or subsidence. Return the results in JSON format with 'type', 'severity' (low, medium, high), and a brief 'description'. If no damage is found, return null.",
    },
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image.split(',')[1],
            },
          },
          { text: "Analyze this road surface for damage." },
        ],
      },
    ],
  });

  const response = await model;
  const text = response.text;
  
  if (!text || text.includes("null")) return { type: "None", severity: "low", description: "No damage detected." };
  
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse AI response", text);
    return { type: "Unknown", severity: "low", description: "Could not analyze image." };
  }
}
