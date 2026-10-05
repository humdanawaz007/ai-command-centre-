function showStatus(message) {
    document.getElementById("status").innerText = message;
}

function sendCommand() {
    const command = document.getElementById("command").value.trim();

    if (command === "") {
        showStatus("⚠️ Please enter a command first.");
        return;
    }

    showStatus("🧠 Command received: " + command);
}

function runAI() {
    showStatus("🧠 AI Assistant opened. Ready for your command.");
}

function trading() {
    showStatus("📈 Trading module opened.");
}

function videoAI() {
    showStatus("🎬 Video AI module opened.");
}

function social() {
    showStatus("📱 Social Media module opened.");
}

function income() {
    showStatus("💰 Income dashboard opened.");
}

function automation() {
    showStatus("⚙️ Automation control centre opened.");
}