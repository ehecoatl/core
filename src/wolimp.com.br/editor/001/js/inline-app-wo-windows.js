const modalChain = [""];
var currentModal = 0;
var popStateObj = null;

WO.modalGet = (m) => bootstrap.Modal.getOrCreateInstance(m, {
	backdrop: m.getAttribute("data-bs-backdrop")??"static",
	keyboard: m.getAttribute("data-bs-keyboard") == "true",
	focus: m.getAttribute("data-bs-focus") == "true",
});

WO.modalBlur = () => document.activeElement && (document.activeElement !== document.body) &&
						(document.activeElement instanceof HTMLElement) && (document.activeElement.blur()||true);
WO.modalHide = (event) => WO.modalBlur() && window.location.hash.endsWith(event.target.id) && history.back(-1);
WO.modalShow = (event) => !window.location.hash.endsWith(event.target.id) && (window.location.href=`#${event.target.id}`);

WO.modalFocus = function (keep = 0) {
	const modalId = (typeof keep === "number") ? (modalChain[keep]??"") : keep;

    document.querySelectorAll('.modal').forEach(m => {
        const modal = WO.modalGet(m);
		m.addEventListener('hide.bs.modal', WO.modalHide, {passive:true});
		m.addEventListener('show.bs.modal', WO.modalShow, {passive:true});
        return !modalId.endsWith(m.id) ? modal.hide() : modal.show();
    });

    return true;
}

WO.modalOpen = function (id) {
	WO.modalFocus(id);
	modalChain.splice(currentModal+1, modalChain.length, window.location.hash);
	currentModal = modalChain.length-1;
	history.replaceState({ window_id: currentModal }, "");
}

function locationHashChanged() {
	if(window.location.hash.length == 0) { return WO.modalFocus(); }
    if(!window.location.hash.startsWith("#modal_")) { return; }

    if(!popStateObj){  WO.modalOpen(window.location.hash); } // NEW HREF CLICK | CLEAN CHAIN FORWARD
    else{ WO.modalFocus(popStateObj.window_id); } //BACK / FORWARD

    popStateObj = null;
}

promise_value(window, 'bootstrap').then((b)=>{
	window.addEventListener('hashchange', locationHashChanged); // HREF CLICK
	window.addEventListener('popstate', (event) => (popStateObj = event.state) );
});
if(window.location.hash.startsWith("#modal_")) { window.location.hash = ""; }