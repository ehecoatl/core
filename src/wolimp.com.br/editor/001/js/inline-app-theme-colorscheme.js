(() => {
  'use strict'

  const getPreferredTheme = () => {
    const option = WO.current_theme;
    if (option === 'auto') { return getDeviceTheme(); }
    return option;
  }

  const getDeviceTheme = () => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const getCurrentTheme = () => document.documentElement.getAttribute('data-bs-theme') ?? getDeviceTheme();
  const setTheme = (option) => {
  	document.documentElement.setAttribute('data-bs-theme', option === "auto" ? getDeviceTheme() : option);
  	
		const theme = getCurrentTheme();
  	document.querySelectorAll("meta[name='theme-color']").forEach((m)=> {
  		m.setAttribute('content', theme == "light" ? "#FFFFFF": "#000000");
  	});
  };

  setTheme(getPreferredTheme());
  document.addEventListener('explorer-show', (e) => {
  	const option = WO.current_theme;

  	e.target.querySelectorAll(`input[name=color-mode-selected]`).forEach((radio)=>{
  		const radio_option = radio.id.replace('radio-color-mode-','');
  		radio.addEventListener('change', (e) => { WO.current_theme = radio_option; setTheme(radio_option); });
  		if(radio_option == option) { radio.checked = true; }
  	});
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (WO.current_theme === 'auto') { setTheme(getPreferredTheme()); }
  }, { passive: true });

})()