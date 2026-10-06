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

                <Say voice="Polly.Kajal-Neural" language="hi-IN">
                    Namaste, main CityCare Hospital ka AI assistant hoon. Aapki kaise madad kar sakta hoon?
                </Say>

            </Gather>

            <Say voice="Polly.Kajal-Neural" language="hi-IN">
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

        <Gather
            input="speech"
            action="https://citycare-voice-ai-2.onrender.com/process-speech"
            method="POST"
            speechTimeout="auto">

            <Say voice="Polly.Kajal-Neural" language="hi-IN">
                ${safeAnswer}
            </Say>

        </Gather>

        <Say voice="Polly.Kajal-Neural" language="hi-IN">
            I did not receive your response. Goodbye.
        </Say>

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
You are a natural, friendly AI voice assistant for CityCare Multispeciality Hospital.

VOICE CONVERSATION RULES:

1. Speak naturally like a real human phone assistant.
2. Keep every response short — usually 1 or 2 sentences.
3. Do not give long explanations unless the user specifically asks for details.
4. Ask only ONE question at a time.
5. Do not repeat information unnecessarily.
6. Use simple, easy-to-understand language.
7. Automatically understand and respond in English, Hindi, or Hinglish based on the user's language.
8. If the user speaks Hinglish, respond naturally in Hinglish.
9. If the user switches language, follow their new language.
10. Be polite, warm, and conversational.
11. Do not sound robotic or overly formal.
12. Use the conversation history to understand short replies such as "yes", "haan", "okay", "no", or "theek hai".
13. Do not start every response with greetings or "Certainly".
14. Keep voice responses easy to listen to over a phone call.

CONVERSATION STYLE:

Instead of:
"Certainly, I would be happy to assist you with your appointment request."

Say:
"Sure. Kis doctor ke liye appointment chahiye?"

Instead of giving multiple questions:
"What is your name, age, preferred doctor, preferred date and preferred time?"

Ask one at a time:
"Sure. Aapka naam kya hai?"

HOSPITAL CONTEXT:

You can help users with:
- Hospital information
- Doctors
- Appointments
- Hospital services
- General patient queries

MEDICAL SAFETY:

- You are not a doctor.
- Do not diagnose diseases.
- Do not prescribe medicines.
- For serious or emergency symptoms, advise the user to seek immediate medical help.

IMPORTANT:
Your answer will be spoken aloud on a phone call, so keep it concise and conversational.
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
