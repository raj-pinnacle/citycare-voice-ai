const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    path: "/media"
});

app.get("/", (req, res) => {
    res.send("CityCare Voice AI Server is running");
});

app.all("/voice", (req, res) => {

    console.log("📞 Twilio requested /voice");
    console.log("Method:", req.method);

    res.type("text/xml");

    res.send(`
        <Response>

            <Gather
                input="speech"
                action="https://kelkoo-cia-kevin-smooth.trycloudflare.com/process-speech"
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

app.use(express.urlencoded({ extended: false }));

app.post("/process-speech", (req, res) => {

    console.log("🗣️ Patient said:");
    console.log(req.body.SpeechResult);

    res.type("text/xml");

    res.send(`
        <Response>
            <Say>
                I heard you say: ${req.body.SpeechResult}
            </Say>

            <Say>
                Thank you. This is the CityCare AI demo.
            </Say>
        </Response>
    `);
});



app.post("/stream-status", (req, res) => {
    console.log("📡 STREAM STATUS");
    console.log("Event:", req.body.StreamEvent);
    console.log("Error:", req.body.StreamError);
    console.log("Call SID:", req.body.CallSid);
    console.log("Stream SID:", req.body.StreamSid);

    res.sendStatus(200);
});


app.post("/call-status", (req, res) => {
    console.log("📞 CALL STATUS");
    console.log("Status:", req.body.CallStatus);
    console.log("Call SID:", req.body.CallSid);

    res.sendStatus(200);
});


wss.on("connection", (ws) => {
    console.log("✅ Twilio connected to WebSocket");

    ws.on("message", (message) => {
        console.log("📩 Message received from Twilio");
        console.log(message.toString());
    });


    ws.on("close", (code, reason) => {
        console.log("❌ Twilio disconnected");
        console.log("Close Code:", code);
        console.log("Close Reason:", reason.toString());
    });
});

server.listen(3000, () => {
    console.log("🚀 Server running on http://localhost:3000");
});