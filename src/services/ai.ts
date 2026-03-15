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
      systemInstruction: "You are an expert civil engineer specializing in road maintenance. Analyze the provided image of a road and detect any damage like potholes, cracks, or subsidence. Return the results in JSON format with 'type', 'damageArea' (a float between 0.0 and 1.0 estimating the proportion of the image area covered by the damage), and a brief 'description'. If no damage is found, return null.",
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
    const rawResult = JSON.parse(text);
    
    // Default damageArea to 0 if not provided
    const damageArea = typeof rawResult.damageArea === 'number' ? rawResult.damageArea : 0;
    
    // Dynamically calculate severity
    let severity: 'low' | 'medium' | 'high' = 'low';
    if (damageArea > 0.35) {
      severity = "high";
    } else if (damageArea > 0.15) {
      severity = "medium";
    } else {
      severity = "low";
    }

    return {
      type: rawResult.type || "Unknown",
      severity,
      description: rawResult.description || "Damage analyzed."
    };
  } catch (e) {
    console.error("Failed to parse AI response", text);
    return { type: "Unknown", severity: "low", description: "Could not analyze image." };
  }
}
