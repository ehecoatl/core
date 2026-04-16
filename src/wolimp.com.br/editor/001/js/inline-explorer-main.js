const date1 = new Date(document.querySelector("meta[name='editor-last-cdn-update']").getAttribute('content')).toISOString()
						.replace(/-|:/g,".").replace(/\.000Z|:[0-9]{2}$/g,"").replace("T","&middot;");

document.getElementById('menu-footer-version').innerHTML = document.querySelector("meta[name='editor-version']").getAttribute('content').split("").join(".");
document.getElementById('menu-footer-modified').innerHTML = `CF ${date1}`;

const TAB_BSCROLL_OPTIONS = {
	mouseWheel: {
      speed: 20,
      invert: false,
      easeTime: 300
    },
	/*infinity: {
		fetch(count) {
			// Fetch data that is larger than count, the function is asynchronous, and it needs to return a Promise.。
			// After you have successfully fetch the data, you need resolve an array of data (or resolve Promise).
			// Each element of the array is list data, which will be rendered when the render method executes。
			// If there is no data, you can resolve (false) to tell the infinite scroll list that there is no more data。
		}
		render(item, div?: HTMLElement) {
			// Rendering each element node, item is data from fetch function
			// div is an element which is recycled from document or undefined
			// The function needs to return to a html element.
		},
		createTombstone() {
			// Must return a tombstone DOM node.
		}
	},*/
    pullDownRefresh: true,
    pullUpRefresh: true,
	scrollbar: true,
	scrollY: true,
	click: true   
};

window.addEventListener('show.bs.dropdown', function(e) {
  const dropdown = e.target.closest('.dropdown');
  const menu = dropdown.querySelector('.dropdown-menu');
  clearTimeout(window._dropdownTimeout??0); // Clear any pending hide timeouts
  menu.style.transition = null;
  menu.style.opacity = 0;
  requestAnimationFrame(()=>{
  	menu.style.transform += ` scaleY(0.3)`;
  	menu.style.transformOrigin =
	  	((menu.style.top == 'auto') ? 'bottom' : 'top') + " " +
	  	((menu.style.left == 'auto') ? 'right' : 'left');
  	requestAnimationFrame(()=>{
	  	menu.style.transition = "transform 0.2s ease-out, opacity 0.2s";
	  	menu.style.transform = menu.style.transform.replace(/scaleY[0-9\.\(\)]+/,"scaleY(1)");
	  	menu.style.opacity = 1;
	});
  });
});
window.addEventListener('hide.bs.dropdown', function(e) {
  const dropdown = e.target.closest('.dropdown');
  const menu = dropdown.querySelector('.dropdown-menu');
  e.preventDefault(); // Prevent default instant hide
  menu.style.transform = menu.style.transform.replace(/scaleY[0-9\.\(\)]+/,"scaleY(0.3)");
  menu.style.opacity = 0;
  window._dropdownTimeout = setTimeout(function() {
    menu.classList.remove('show');
    menu.style.transform = null;
    menu.style.inset = null;
    dropdown.dispatchEvent(new Event('hidden.bs.dropdown')); 
  }, 250); // 250ms delay before hiding
});

window.addEventListener('explorer-show', (e) => {

	/*Activates stored current or first tab*/
	promise_value(window,'bootstrap').then(bootstrap => {
		document.querySelectorAll('.explorer-bottom-tab-line a.nav-link[data-bs-toggle="tab"]').forEach(t => {
		  //if(t.classList.contains('active')) { setTimeout(()=>animLineMatch(t),1000); }

		  t.addEventListener('shown.bs.tab', (event) => {
			const tab_panel = document.querySelector(`${event.target.getAttribute('data-bs-target')}`);
		  	const panel_sibling_index = getSiblingIndex(tab_panel);
		  	const pct = -100*panel_sibling_index;
		  	document.getElementById("tab-scroller").style.transform = `translateX(${pct}%)`;

		  	navigator.vibrate(btn_vibrate);
		  	if(event.target.closest('#main-explorer-navbar')){
		  		WO.current_tab = event.target.id;
		  	}

		  	promise_value(window,'animLineMatch').then((a)=>a(event.target));
		  }, { passive: true });

		  t.addEventListener('hidden.bs.tab', event => {}, { passive: true });
		});

		const tab = bootstrap.Tab.getOrCreateInstance(document.querySelector("#"+WO.current_tab));
		tab.show();

		setTimeout(()=>{window.animLineMatch = window.animLineMatch2;},250);
	});

	/*Activates the betterscroll library*/
	promise_value(window,'BetterScroll').then((bs)=>{
		requestAnimationFrame(()=> {
			window.Bscroll_Tabs = [];
			document.querySelectorAll('.bscroll_wrapper').forEach((e) => window.Bscroll_Tabs.push(bs.createBScroll(e, TAB_BSCROLL_OPTIONS)) );
			
			for(let bs of window.Bscroll_Tabs) { 
				bs.on('scroll', ()=>set_freeze_hammerjs(true)); 
				bs.on('scrollEnd', ()=>set_freeze_hammerjs(false)); 
			}
		});
	});

	promise_value(window,'google').then((google)=>{
		google.accounts.id.initialize({
		  context: "use",
		  color_scheme: document.documentElement.getAttribute('data-bs-theme'),
		  client_id: "745351054029-ir7d2ae37e1vmb5rvehmo21rfthej8sb.apps.googleusercontent.com",
		  callback: handleCredentialResponse
		});

		google.accounts.id.renderButton(
		  document.getElementById("google-signin-button"),
		  {
		  	size: "large",
		  	width: 100,
		  	type: "standard", //icon
		  	theme: "filled_black",
		  	text: "continue_with",
		  	shape: "circle",
		  	logo_alignment: "left"
		  }
		);

		//inly
		google.accounts.id.prompt(); // also display the One Tap dialog
	});

	promise_value(window,'Hammer').then((h)=>{
		//One hammer for each object
		window.mc = new Hammer.Manager(window, {
			recognizers: [
				[Hammer.Pan, { direction: Hammer.DIRECTION_HORIZONTAL, threshold: 10 }],
				[Hammer.Tap, { time: 1000, interval: 100, threshold: 25 }]
			]
		});
		window.delayedTapEvents = [];
		mc.on('tap', async (e)=>{
			console.log("TAP");
			const t = e.srcEvent.target;
			const btn = (t.onclick) ? t : ( t.closest ? (t.closest("[onclick]")??t) : t );
			window.delayedTapEvents.push(btn);
			await new Promise((resolve)=>setTimeout(resolve, 50));
			if(window.delayedTapEvents.indexOf(btn) == -1) return;
			console.log("TAP CLICK", btn);
			btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: e.srcEvent.clientX, clientY: e.srcEvent.clientY }));
		});
		window.addEventListener('click', (e)=>{
			const t = e.target;
			const btn = (t.onclick) ? t : ( t.closest ? (t.closest("[onclick]")??t) : t );
			const i = window.delayedTapEvents.indexOf(btn);
			if(i > -1) { window.delayedTapEvents.splice(i,1); }
		});
	});

});

function handleCredentialResponse(response) {
	const responsePayload = decodeJwtResponse(response.credential);

	console.log("ID: " + responsePayload.sub);
	//console.log('Full Name: ' + responsePayload.name);
	console.log('Given Name: ' + responsePayload.given_name);
	//console.log('Family Name: ' + responsePayload.family_name);
	console.log("Image URL: " + responsePayload.picture);
	console.log("Email: " + responsePayload.email);

	//Shortcut to display user data //But backend still happens
}

function decodeJwtResponse(token) {
	let base64Url = token.split('.')[1];
	let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
	let jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
	    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
	}).join(''));

	return JSON.parse(jsonPayload);
}