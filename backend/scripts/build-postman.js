'use strict';
const fs = require('node:fs');
const path = require('node:path');
const item = (name, route, checks) => ({name,request:{method:'GET',header:[{key:'Accept',value:'application/json'}],url:'{{base_url}}'+route},event:[{listen:'test',script:{type:'text/javascript',exec:[
  "pm.test('HTTP 200', () => pm.response.to.have.status(200));",
  "const body = pm.response.json();",
  ...checks,
]}}]});
const listChecks = [
  "pm.test('Pagination fields', () => { ['page','total_pages','total_results'].forEach(k => pm.expect(body[k]).to.be.a('number')); });",
  "pm.test('Movie fields', () => { pm.expect(body.results).to.be.an('array').that.is.not.empty; body.results.forEach(m => { ['id','title','poster_path','release_date','vote_average','genre_ids'].forEach(k => pm.expect(m).to.have.property(k)); pm.expect(m.genre_ids).to.be.an('array'); }); });",
];
const collection = {
  info:{name:'Movie Magic - Arthur - TMDb exploration',schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',description:'Live TMDb v3 requests. Set tmdb_token locally; do not export credentials. Tests inspect raw TMDb responses.'},
  auth:{type:'bearer',bearer:[{key:'token',value:'{{tmdb_token}}',type:'string'}]},
  variable:[{key:'base_url',value:'https://api.themoviedb.org/3'},{key:'movie_id',value:'27205'},{key:'language',value:'en-US'}],
  item:[
    item('Search movies','/search/movie?query=Inception&page=1&language={{language}}&include_adult=false',[...listChecks,"if (body.results?.length) pm.collectionVariables.set('movie_id',body.results[0].id);"]),
    item('Discover movies','/discover/movie?with_genres=878&primary_release_year=2010&vote_average.gte=7&vote_count.gte=100&sort_by=vote_average.desc&page=1&language={{language}}', [...listChecks,"pm.test('Filters respected', () => body.results.forEach(m => { pm.expect(m.genre_ids).to.include(878); pm.expect(m.vote_average).to.be.at.least(7); pm.expect(m.release_date).to.match(/^2010/); }));"]),
    item('Genre list','/genre/movie/list?language={{language}}',["pm.test('Genres have id and name', () => { pm.expect(body.genres).to.be.an('array').that.is.not.empty; body.genres.forEach(g => { pm.expect(g.id).to.be.a('number'); pm.expect(g.name).to.be.a('string'); }); });"]),
    item('Movie details','/movie/{{movie_id}}?language={{language}}',["pm.test('Details and genre objects', () => { pm.expect(body.id).to.equal(Number(pm.collectionVariables.get('movie_id'))); pm.expect(body.title).to.be.a('string'); pm.expect(body.genres).to.be.an('array'); });"]),
    item('Details with cast and videos','/movie/{{movie_id}}?append_to_response=credits,videos&language={{language}}',[
      "pm.test('Details, cast and videos in one response', () => { pm.expect(body.id).to.equal(Number(pm.collectionVariables.get('movie_id'))); pm.expect(body.credits.cast).to.be.an('array'); pm.expect(body.videos.results).to.be.an('array'); });",
      "pm.test('Trailer fields', () => { body.videos.results.filter(v => v.type === 'Trailer').forEach(v => { ['key','site','name','type'].forEach(k => pm.expect(v).to.have.property(k)); }); });",
    ]),
  ],
};
fs.writeFileSync(path.join(__dirname,'../postman/TMDb.postman_collection.json'),JSON.stringify(collection,null,2)+'\n');
fs.writeFileSync(path.join(__dirname,'../postman/TMDb.postman_environment.json'),JSON.stringify({name:'TMDb - local credentials',values:[{key:'tmdb_token',value:'',type:'secret',enabled:true}],_postman_variable_scope:'environment'},null,2)+'\n');
console.log('Generated credential-free Postman collection and environment.');
