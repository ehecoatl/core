async function callWolimpCloud(path="/user_data", method="GET", data=null){
	const req_header = { 'Content-Type': 'application/json', 'axis-csrf-token': '' };
	
	/*try{
		const csrf_data = {path_destiny: `/cloud${path}`};
		const csrf_response = await fetch("/api/gen_csrf", { method: 'POST', headers: req_header, body: JSON.stringify(csrf_data) });
		if (!csrf_response.ok) { throw new Error(`HTTP error! status: ${csrf_response.status}`); }
	}catch(e){
		throw e;
	}*/

	try{
		const options = { method: method };
		if(method != "GET") options.headers = req_header; 
		if(data && typeof data === "object"){
			if(method == "GET") { path += `?${(new URLSearchParams(data)).toString()}`; }
			else { options.body = JSON.stringify(data); }
		}
		const response = await fetch(`/cloud${path}`, options);
		if (!response.ok) { console.error(`HTTP error! status: ${response.status}`); }
		else { return response.json(); }
	}catch(e){
		console.error(`Cloud call error`, e);
	}
	return null;
}