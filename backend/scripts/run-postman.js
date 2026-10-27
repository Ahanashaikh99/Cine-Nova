'use strict';
require('dotenv').config({quiet:true});
const fs = require('node:fs');
const path = require('node:path');
const newman = require('newman');
const token = process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_TOKEN;
const apiKey = process.env.TMDB_API_KEY;
if (!token && !apiKey) { console.error('Set a server-side TMDb credential first.'); process.exitCode=1; }
else {
  const collection = JSON.parse(fs.readFileSync(path.join(__dirname,'../postman/TMDb.postman_collection.json'),'utf8').replace(/^\uFEFF/,''));
  if (!token) collection.auth = {type:'apikey',apikey:[{key:'key',value:'api_key',type:'string'},{key:'value',value:'{{tmdb_api_key}}',type:'string'},{key:'in',value:'query',type:'string'}]};
  // No CLI/JSON reporter: reporters can include headers or authenticated URLs.
  newman.run({collection,envVar:[{key:'tmdb_token',value:token || ''},{key:'tmdb_api_key',value:apiKey || ''}],reporters:[],timeoutRequest:15000},(error,summary) => {
    if (error || !summary) { console.error('Postman collection could not run.'); process.exitCode=1; return; }
    const report = {
      executedAt:new Date().toISOString(),runner:'Newman (Postman collection CLI)',
      requests:summary.run.executions.map(e => ({name:e.item.name,status:e.response?.code,assertions:(e.assertions || []).map(a => ({name:a.assertion,passed:!a.error}))})),
      assertionStats:summary.run.stats.assertions,
      failures:summary.run.failures.length,
    };
    fs.writeFileSync(path.join(__dirname,'../docs/postman-verification.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
    if (report.failures) process.exitCode=1;
  });
}
