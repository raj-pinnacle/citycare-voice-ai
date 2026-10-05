const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    path: "/media"
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());


// ===============================
// Conversation Memory
// ===============================

const conversations = new Map();


// ===============================
// XML Escape Helper
// ===============================

function escapeXml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}


// ===============================
// Home
// ===============================

app.get("/", (req, res) => {
    res.send("CityCare Voice AI Server is running");
});


// ===============================
// Twilio Voice Webhook
// ===============================

app.all("/voice", (req, res) => {

    console.log("📞 Twilio requested /voice");

    res.type("text/xml");

    res.send(`
        <Response>

            <Gather
                input="speech"
                action="https://citycare-voice-ai-2.onrender.com/process-speech"
                method="POST"
                speechTimeout="auto">

                <Say>
                    Hello, I am CityCare Hospital AI Assistant.
                    Please tell me how I can help you.
                </Say>

            </Gather>

            <Say>
                I did not receive your response. Goodbye.
            </Say>

        </Response>
    `);
});


// ===============================
// Speech Processing + Sarvam AI
// ===============================

app.post("/process-speech", async (req, res) => {

    const speech = req.body.SpeechResult;
    const callSid = req.body.CallSid;

    console.log("🗣️ Patient said:", speech);
    console.log("📞 Call SID:", callSid);


    if (!speech) {

        res.type("text/xml");

        return res.send(`
            <Response>
                <Say>
                    Sorry, I could not understand you.
                    Please say that again.
                </Say>

                <Gather
                    input="speech"
                    action="https://citycare-voice-ai-2.onrender.com/process-speech"
                    method="POST"
                    speechTimeout="auto">

                    <Say>
                        How can I help you?
                    </Say>

                </Gather>
            </Response>
        `);
    }


    // ===============================
    // Get conversation history
    // ===============================

    let history = conversations.get(callSid);

    if (!history) {

        history = [
            {
                role: "system",
                content: `
You are the CityCare Multispeciality Hospital AI Assistant.

You are speaking with a patient over a phone call.

Your job is to:
- Understand the patient's question.
- Give short and simple answers.
- Speak naturally like a helpful hospital assistant.
- Support English, Hindi and Hinglish.
- Ask one question at a time.
- Help with appointments, hospital services, doctors and general patient queries.

Important:
- You are not a doctor.
- Do not diagnose diseases.
- Do not prescribe medicines.
- For serious or emergency symptoms, advise the patient to seek immediate medical help or contact emergency services.
- Keep voice responses short because the response will be spoken over a phone call.
`
            }
        ];

        conversations.set(callSid, history);
    }


    // Add patient message
    history.push({
        role: "user",
        content: speech
    });


    try {

        console.log("🤖 Sending request to Sarvam...");


        // ===============================
        // Sarvam API
        // ===============================

        const sarvamResponse = await fetch(
            "https://api.sarvam.ai/v1/chat/completions",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "api-subscription-key": process.env.SARVAM_API_KEY
                },

                body: JSON.stringify({
                    model: "sarvam-105b-conversations",

                    messages: history,

                    temperature: 0.2,

                    max_tokens: 150,

                    reasoning_effort: null
                })
            }
        );


        const data = await sarvamResponse.json();


        console.log("🤖 Sarvam status:", sarvamResponse.status);


        if (!sarvamResponse.ok) {

            console.error("❌ Sarvam API Error:");
            console.error(JSON.stringify(data, null, 2));

            throw new Error("Sarvam API request failed");
        }


        // ===============================
        // Get AI answer
        // ===============================

        const answer =
            data?.choices?.[0]?.message?.content ||
            "Sorry, I could not generate a response.";


        console.log("🤖 AI:", answer);


        // Save AI response
        history.push({
            role: "assistant",
            content: answer
        });


        conversations.set(callSid, history);


        // ===============================
        // Send AI answer to Twilio
        // ===============================

        const safeAnswer = escapeXml(answer);


        res.type("text/xml");

        res.send(`
            <Response>

                <Gather
                    input="speech"
                    action="https://citycare-voice-ai-2.onrender.com/process-speech"
                    method="POST"
                    speechTimeout="auto">

                    <Say>
                        ${safeAnswer}
                    </Say>

                </Gather>

                <Say>
                    I did not receive your response. Goodbye.
                </Say>

            </Response>
        `);


    } catch (error) {

        console.error("❌ ERROR:", error);


        res.type("text/xml");

        res.send(`
            <Response>

                <Say>
                    Sorry, I am having trouble connecting to the AI assistant.
                    Please try again later.
                </Say>

            </Response>
        `);
    }
});


// ===============================
// Call Status
// ===============================

app.post("/call-status", async (req, res) => {

    console.log("📞 CALL STATUS");

    const status = req.body.CallStatus;
    const callSid = req.body.CallSid;

    console.log("Status:", status);
    console.log("Call SID:", callSid);

    // Save transcript only when call is completed
    if (status === "completed") {

        const history = conversations.get(callSid);

        if (!history) {
            console.log("⚠️ No conversation history found");
            return res.sendStatus(200);
        }

        // Create readable transcript
        const transcript = history
            .filter(item => item.role === "user" || item.role === "assistant")
            .map(item => {
                const speaker =
                    item.role === "user"
                        ? "Patient"
                        : "AI";

                return `${speaker}: ${item.content}`;
            })
            .join("\n");

        try {

            const response = await fetch(
                process.env.GOOGLE_SHEET_WEBHOOK_URL,
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({
                        callSid: callSid,
                        dateTime: new Date().toISOString(),
                        patient: "Voice Patient",
                        transcript: transcript
                    })
                }
            );

            console.log(
                "📊 Google Sheet status:",
                response.status
            );

            console.log(
                "📊 Transcript saved to Google Sheet"
            );

        } catch (error) {

            console.error(
                "❌ Google Sheet error:",
                error
            );
        }

        // Remove conversation from memory
        conversations.delete(callSid);
    }

    res.sendStatus(200);
});

// ===============================
// WebSocket
// ===============================

wss.on("connection", (ws) => {

    console.log("✅ Twilio connected to WebSocket");

    ws.on("message", (message) => {

        console.log("📩 Message received from Twilio");

        console.log(message.toString());

    });

    ws.on("close", (code, reason) => {

        console.log("❌ Twilio disconnected");

        console.log("Close Code:", code);

        console.log(
            "Close Reason:",
            reason.toString()
        );

    });

});


// ===============================
// Server
// ===============================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log(
        `🚀 Server running on port ${PORT}`
    );

});
