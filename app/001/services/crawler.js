global.dnsPromises = global.dnsPromises ?? require('dns').promises;

const bots_ips = [];
const bots_hostnames = global.config.crawler.bots_hostnames;

module.exports = {
    testReverseForwardDNS: async (ip) =>{
      try {
          const user_hostnames = await global.dnsPromises.reverse(ip);
          console.log(`Hostnames for ${ip}:`, user_hostnames);
          for(const h of user_hostnames) {
            for(const s of bots_hostnames){ 
              if(h.endsWith(s)) {
                const result = await dnsPromises.resolve(h);
                console.log(`IP Address: ${result}`);
                if( result.indexOf(ip) > -1){
                  return true;
                }
              }
            }
          }
          return false;
      } catch (err) {
          //console.error(`Reverse DNS lookup failed for ${ip}:`, err);
          return false;
      }
  }
}

const getJsonFromUrl = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      return [];
    }
    return (await response.json());
  } catch (error) {
    console.error("Error fetching or parsing JSON:", error);
    return [];
  }
}

async function updateCrawlerBotIps(){
  const bots_json = global.config.crawler.bots_json;
  for(const b in bots_json){
    try{
      const data = await getJsonFromUrl(b);
      if("prefixes" in data){
        for(const i of data.prefixes){ 
          bots_ips.push( i.ipv6Prefix ?? i.ipv4Prefix ); 
        }
      }
    }catch(e){
      console.error(e);
    }
  }

  log("CRAWLER BOTS IPS - updated");
}
//updateCrawlerBotIps();