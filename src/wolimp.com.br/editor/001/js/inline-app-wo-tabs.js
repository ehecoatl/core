const btn_vibrate = 50;

async function closeNavBars(){
	navigator.vibrate(btn_vibrate);
	document.querySelector('.wo-navbar.show').classList.remove('show');
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.querySelector('main').classList.remove('move_left','move_right', 'move_up', 'move_down');
}

function openNavBar(name){
	const nav = typeof name == "string" ? document.querySelector(name) : name;
	if(!nav) return;
	const direction = nav.getAttribute("data-main-direction");
	nav.classList.add('show');
	if(direction) { document.querySelector('main').classList.add('move_'+direction); }
	navigator.vibrate(btn_vibrate);
}

function getChildRectInParent(t,e){let i=t.getBoundingClientRect(),n=e.getBoundingClientRect(),o={top:i.top-n.top,left:i.left-n.left,right:i.right-n.left,bottom:i.bottom-n.top,width:i.width,height:i.height,x:i.x-n.x,y:i.y-n.y};return o}
function getSiblingIndex(e){if(!e||!e.parentElement)return -1;let n=Array.from(e.parentElement.children);return n.indexOf(e)}

function mainScrollerNextTab(){
	const current = document.querySelector(".nav-link.active[data-bs-toggle]");
	const index = getSiblingIndex(current.parentElement);
	if(index == -1 || index >= current.closest('ul').querySelectorAll('li').length-1) {
		openNavBar(document.querySelector(`[data-main-direction="left"]`));
		return;
	}
	const tab = bootstrap.Tab.getOrCreateInstance(current.closest('ul').children[index+1].children[0]);
	tab.show();
}

function mainScrollerPrevTab(){
	const current = document.querySelector(".nav-link.active[data-bs-toggle]");
	const index = getSiblingIndex(current.parentElement);
	if(index <= 0) {
		openNavBar(document.querySelector(`[data-main-direction="right"]`));
		return;
	}
	const tab = bootstrap.Tab.getOrCreateInstance(current.closest('ul').children[index-1].children[0]);
	tab.show();
}

async function setupHorizontalDragBox(selector, options={}){
	await promise_value(window,'Hammer');
	await promise_value(window.Hammer,'Manager');

	document.querySelectorAll(selector).forEach((element)=>{
		element.setAttribute("dragbox-dragable", true);
		element.setAttribute("dragable", true);
		element.childMovable = element.querySelector(options.child_movable)??element;
		element.dragOptions = options;		
	});
}

	window.animLineMatch2 = (tab_element) => {
		requestAnimationFrame(()=>{
		  	const parent_navbar = tab_element.closest('.explorer-bottom-tab-line');
		  	const future_rect = getChildRectInParent(tab_element, parent_navbar); //FORCED
			const tab_panel = document.querySelector(`${tab_element.getAttribute('data-bs-target')}`);
		  	const line_element = parent_navbar.querySelector('.explorer-tab-line');

		  	const margin = "20px";

		  	line_element.style.width = `calc(${100/(parent_navbar.children.length-1)}% - ${margin}*2)`;

		  	const ease_out = `cubic-bezier(.3, -0.23, 0, 1.4)`;
		  	const ease_in = `cubic-bezier(1, -0.22, .38, 1.26)`;
			
				line_element.style.willChange = 'transform, opacity';
				line_element.style.transition = line_element.style.opacity == 0 ? null:`transform 0.2s ${ease_in}, opacity 0.2s linear`;
				line_element.style.opacity = line_element.style.opacity == 0 ? 0 : 0.1;
				line_element.style.transform = line_element.style.transform.replace(/scaleX\([0-9\.]+\)/,`scaleX(0.6)`);
				setTimeout(()=>{
					line_element.style.transition = `transform 0.3s ${ease_out}, opacity 0.3s linear`;
					line_element.style.transform = `translateX(calc(${future_rect.left}px + ${margin})) scaleX(1.1)`;
					//line_element.style.transformOrigin = `calc(${future_rect.left+future_rect.width/2}px + ${margin}) 0`;
				  line_element.style.opacity = 1;
				  setTimeout(()=>{
						line_element.style.transition = `transform 0.2s ${ease_in}, opacity 0.3s linear`;
				  	line_element.style.transform = line_element.style.transform.replace(/scaleX\([0-9\.]+\)/,`scaleX(1)`);
						line_element.style.willChange = null;
				  },200);
				},200);

		  	const panel_sibling_index = getSiblingIndex(tab_panel);
		  	const pct = -100*panel_sibling_index;
		  	document.getElementById("tab-scroller").style.transform = `translateX(${pct}%)`;
		});
	}

	window.addEventListener('explorer-loaded', (e)=>{
		var mobile_width = parseInt(window.getComputedStyle(document.body).getPropertyValue('--max-width-mobile'));
		setupHorizontalDragBox(".wo-navbar[data-main-direction='right']", { delayRestartTransition: 400, restrict_width:mobile_width, lock_min:-200, lock_max:0, lock_time:0, move_min:20, child_movable:'.menu', trigger_right: closeNavBars, trigger_left: closeNavBars});
		setupHorizontalDragBox(".wo-navbar[data-main-direction='left']", { delayRestartTransition: 400, lock_min:0, lock_max:200, lock_time:0, move_min:20, child_movable:'.menu', trigger_right: closeNavBars, trigger_left: closeNavBars });
		setupHorizontalDragBox("#tab-scroller", { trigger_left: mainScrollerPrevTab, trigger_right: mainScrollerNextTab, lock_time:0.2 });
	});

	promise_value(window,'mc').then((mc)=>{
		window.execute_swipe = (e)=>{
			const target = e.srcEvent.target.closest('[dragbox-dragable]');
			const options = target.dragOptions;
			const clampedDeltaX = Math.max( options.lock_min??-9999, Math.min( options.lock_max??9999, e.deltaX));
			if(clampedDeltaX > 0) { return options.trigger_left()??null; }
			else { return options.trigger_right()??null; }
		};

		window.freeze_by_scroll = false;
		window.set_freeze_hammerjs = (freeze=true)=>{
			window.freeze_by_scroll = freeze;
		}

		mc.on('panstart', (e) =>{
			if(!e.srcEvent.target) return;
			const target = e.srcEvent.target.closest('[dragbox-dragable]');
			if(!target || target.getAttribute("dragbox-dragging") || !target.getAttribute("dragbox-dragable")) return;

			const options = target.dragOptions;
			const childMovable = target.childMovable;
			if(options.restrict_width && document.documentElement.clientWidth > options.restrict_width) return;
		  target.setAttribute("dragbox-dragging", true);
		  target.setAttribute("dragbox-start-transform-x", (childMovable.style.transform??""));
		  target.setAttribute("dragbox-start-transition", childMovable.style.transition);
		  childMovable.style.willChange = 'transform';
		  childMovable.style.cursor = 'grabbing';
		  target.setPointerCapture(e.srcEvent.pointerId);
		});
		mc.on('panmove', (e) =>{
			if(!e.srcEvent.target) return;
			const target = e.srcEvent.target.closest('[dragbox-dragable]');
			if(!target || !target.getAttribute("dragbox-dragging") || !target.getAttribute("dragbox-dragable")) return;

			const options = target.dragOptions;
			const childMovable = target.childMovable;
			const clampedDeltaX = Math.max( options.lock_min??-9999, Math.min( options.lock_max??9999, e.deltaX));
			var start = target.getAttribute("dragbox-start-transform-x");
			if(start.length > 0) { start = start.match(/([0-9-\.%]+(px)?)/g,"$1")[0]+" + "; }
			childMovable.style.transition = `transform 0.1s linear`;
			childMovable.style.transform = `translateX(calc(${start}${clampedDeltaX}px))`;

			if(window.freeze_by_scroll){
				target.removeAttribute("dragbox-dragging");
				childMovable.style.transform = target.getAttribute("dragbox-start-transform-x");
				childMovable.style.transition = `transform 0.25s ease-in`;
			}
		});
		mc.on('panend', async (e) =>{
			if(!e.srcEvent.target) return;
			const target = e.srcEvent.target.closest('[dragbox-dragable]');
			if(!target || !target.getAttribute("dragbox-dragging") || !target.getAttribute("dragbox-dragable")) return;

			target.releasePointerCapture(e.srcEvent.pointerId);
			const options = target.dragOptions;
			const childMovable = target.childMovable;
		  const element_rect = childMovable.getBoundingClientRect();
			target.removeAttribute("dragbox-dragging");
			childMovable.style.transform = target.getAttribute("dragbox-start-transform-x");
			childMovable.style.transition = `transform 0.25s ease-in`;
		  childMovable.style.willChange = null;
		  childMovable.style.cursor = null;

			const clampedDeltaX = Math.max( options.lock_min??-9999, Math.min( options.lock_max??9999, e.deltaX));
			if(Math.abs(clampedDeltaX) > element_rect.width*0.30 || (e.deltaTime < 250 && Math.abs(clampedDeltaX) > 25)){
				execute_swipe(e);
			}else{
				const delayRestartTransition = options.delayRestartTransition??0;
				if(delayRestartTransition > 0){
					await new Promise((resolve) => setTimeout(resolve, delayRestartTransition));
				}

				childMovable.style.transition = target.getAttribute("dragbox-start-transition");
			}
		});
	});