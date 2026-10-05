function startAI() {
    const command = prompt("What do you want me to do?");

    if (!command) {
        return;
    }

    const text = command.toLowerCase();

    if (text.includes("hello") || text.includes("hi")) {
        alert("Hello! AI Command Centre is ready.");
    } 
    else if (text.includes("trading")) {
        alert("Trading module opened. Trading analysis will be added next.");
    } 
    else if (text.includes("video")) {
        alert("Video AI module opened. Video automation will be added next.");
    } 
    else if (text.includes("social")) {
        alert("Social Media module opened. Social automation will be added next.");
    } 
    else if (text.includes("income")) {
        alert("Income module opened. Income tracking will be added next.");
    } 
    else if (text.includes("automation")) {
        alert("Automation module opened. Automation controls will be added next.");
    } 
    else {
        alert("I received your command: " + command);
    }
}