//Toast Stack
window.currentToastMessage = "";
window.runToastMessage = async e => {
    const t = document.getElementById("toast-message-box").querySelector("div");
    t.classList.add("show");
    t.innerHTML = e.detail.message;
    await new Promise(e => setTimeout(e, 2000));
    t.classList.add("hide");
    await new Promise(e => setTimeout(e, 500));
    const n = t.style.transition;
    t.style.transition = null;
    t.classList.remove("show");
    t.classList.remove("hide");
    await new Promise(e => setTimeout(e, 10));
    t.style.transition = n;
}
window.addEventListener("wolimp-toast", window.runToastMessage);