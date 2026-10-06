function openAssistant() {
    const command = prompt(
        "🧠 AI Assistant\n\nWhat do you want me to do?"
    );

    if (command !== null && command.trim() !== "") {
        alert("AI Assistant received:\n\n" + command);
    }
}

function openTrading() {
    alert("📈 Trading module coming next.");
}

function openVideo() {
    alert("🎬 Video AI module coming next.");
}

function openSocial() {
    alert("📱 Social Media module coming next.");
}