
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@^0.1.3";

export default async (request: Request) => {
    const API_KEY = Deno.env.get("GEMINI_API_KEY");

    if (!API_KEY) {
        return new Response(JSON.stringify({ error: "Missing Gemini API Key" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    const genAI = new GoogleGenerativeAI(API_KEY);

    try {
        const { action, payload } = await request.json();

        if (action === "chat") {
            const { model, history, message, systemInstruction, config } = payload;
            const chatModel = genAI.getGenerativeModel({
                model: model,
                systemInstruction: systemInstruction,
                generationConfig: config
            });
            const chat = chatModel.startChat({ history });
            const result = await chat.sendMessage(message);
            const response = await result.response;
            return new Response(JSON.stringify({ text: response.text() }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        if (action === "stream-chat") {
            const { model, history, message, systemInstruction, config } = payload;
            const chatModel = genAI.getGenerativeModel({
                model: model,
                systemInstruction: systemInstruction,
                generationConfig: config
            });
            const chat = chatModel.startChat({ history });

            const result = await chat.sendMessageStream(message);

            const stream = new ReadableStream({
                async start(controller) {
                    try {
                        for await (const chunk of result.stream) {
                            const chunkText = chunk.text();
                            controller.enqueue(new TextEncoder().encode(chunkText));
                        }
                        controller.close();
                    } catch (error) {
                        console.error("Streaming error:", error);
                        controller.error(error);
                    }
                },
            });

            return new Response(stream, {
                headers: {
                    "Content-Type": "text/plain; charset=utf-8",
                    "Transfer-Encoding": "chunked",
                },
            });
        }

        // New action for multimodal chat (one-shot generation with media)
        if (action === "generate-content") {
            const { model, contents, systemInstruction, config } = payload;
            const genModel = genAI.getGenerativeModel({
                model: model,
                systemInstruction: systemInstruction,
                generationConfig: config
            });

            // The SDK expects contents to be in a specific format.
            // We assume 'contents' passed here matches the SDK requirement or we need to map it.
            // Simple mapping if payload is slightly different, but likely we pass it directly.
            const result = await genModel.generateContent({ contents });
            const response = await result.response;
            return new Response(JSON.stringify({ text: response.text() }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        if (action === "embedding") {
            const { model, text } = payload;
            const embedModel = genAI.getGenerativeModel({ model });
            const result = await embedModel.embedContent(text);
            return new Response(JSON.stringify({ values: result.embedding.values }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ error: "Invalid action" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Gemini Proxy Error:", error);
        return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};

export const config = { path: "/api/gemini" };
