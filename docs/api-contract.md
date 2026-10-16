# API contract — frontend and backend shared authority

All paths below begin `/api`. Backend runs on 127.0.0.1:8765. Next.js proxies `/api/:path*` to it via rewrite; frontend runs 127.0.0.1:3000. JSON snake_case. Return meaningful HTTP errors `{detail: string}`. Timestamps ISO UTC. Numbers nullable, false is a valid boolean.

## Video

`{id:string, url:string, title:string, channel:string|null, channel_id:string|null, channel_url:string|null, channel_handle:string|null, thumbnail_url:string|null, duration:number|null, view_count:number|null, upload_date:string|null, content_type:"video"|"shorts"|"livestream"|"unknown", live_status:string|null, categories:string[], description:string|null, tags:string[], like_count:number|null, channel_follower_count:number|null, channel_is_verified:boolean|null, license:string|null, chapters:{title:string,start_time:number,end_time:number|null}[], subtitle_languages:{code:string,name:string,kind:"manual"|"automatic"}[], metadata_level:"quick"|"full", saved:boolean, saved_at:string|null, updated_at:string, review_status:"todo"|"keep"|"skip", notes:string, personal_tags:string[], source:string|null}`

`GET /health` -> `{status:"ok", yt_dlp_version:string, database:string}`

`GET /catalog` -> `{categories:{id:string,title:string,label:string,legacy:boolean}[], metadata_groups:string[], native_features:{id:string,label:string}[]}`. Include 32 cached category IDs with historical labels, clearly not a live regional catalog. Use category IDs as form values; backend translates to returned category names. `unknown` means missing category; empty or all means unrestricted.

## Jobs

`POST /jobs` body:
```
{
 source_type: "keyword"|"channel"|"playlist"|"video"|"search",
 sources: string[],
 limit: 100,
 mode: "full"|"quick",
 existing_policy: "skip"|"update",
 filters: {
  category?:string,
  duration_min?:number, duration_max?:number,
  views_min?:number, views_max?:number,
  date_after?:string, date_before?:string,
  content_types?:string[], live_status?:string,
  playlist_start?:number, playlist_end?:number
 },
 native: {
  result_type?:"videos"|"longform"|"shorts"|"channels"|"playlists"|"movies",
  order?:"relevance"|"popularity",
  upload_date?:"all"|"today"|"week"|"month"|"year",
  duration?:"all"|"short"|"medium"|"long",
  features?:string[]
 }
}
```
All durations in **seconds**, dates YYYY-MM-DD; content_types lower-case `video,shorts,livestream`. Native feature IDs: live,4k,hd,cc,creative,360,vr180,3d,hdr,location. Default keyword/video+shorts, relevance, all other native filters empty. Input limit bounded 1..1000, max20 sources, max30 queued jobs, full mode forced when precise filters need it. Categories/likes/date require detailed extraction when absent in a flat listing. Empty keyword or non-YouTube URL -> 422. Source types must match the supplied URL kind, accept `youtu.be`, www/m.youtube.com, music.youtube.com and channel tabs. Never accept arbitrary yt-dlp flags.

Return 202 Job. `Job = {id:string,status:"queued"|"running"|"completed"|"partial"|"failed"|"cancelled"|"interrupted", kind:"crawl"|"refresh"|"save", source_type:string,sources:string[],mode:string,limit:number,phase:string,scanned_count:number,matched_count:number,failed_count:number,skipped_count:number,total_count:number|null,created_at:string,started_at:string|null,finished_at:string|null,error:string|null,errors:{source:string,message:string}[]}`.

`GET /jobs?page=1&page_size=20` -> Page<Job>.
`GET /jobs/{id}` -> Job.
`POST /jobs/{id}/cancel` -> Job.
`POST /jobs/{id}/retry` -> new Job, retry failures/interrupted input, 409 if no retryable work.
`GET /jobs/{id}/resources` -> `{items:{id:string,title:string,url:string,kind:"channel"|"playlist",thumbnail_url:string|null}[]}`. Resource search yields selectable channels/playlists. Opening one starts a new crawl for its URL. No pretend videos for resources.

## Video pages and warehouse

`Page<T>={items:T[],total:number,page:number,page_size:number}`.

`GET /videos?scope=library|job&job_id=...&page=1&page_size=50&q=...&sort=views|newest|duration|updated|saved&status=all|todo|keep|skip&existing=all|new|saved&group_kind=channels|playlists|categories&group_key=...&content_type=all|video|shorts|livestream`
`scope=job` requires job_id; missing scope defaults library. Results bounded page_size<=100. Match grouping to saved subset only. `q` token search server-side, avoid shipping all rows. Sort nulls last with ID tie-breakers.

`GET /videos/{id}` -> Video.
`POST /library/save` body `{video_ids:string[]}` -> `{saved_count:number,job_id:string|null}`; detailed records save immediately, quick ones enrich via job before marking saved. Must not create duplicate video rows or reset review. Return async job_id when needed.
`PATCH /videos/{id}/review` body `{review_status?:"todo"|"keep"|"skip",notes?:string,personal_tags?:string[]}` -> Video. Saved records only, 409 otherwise.
`POST /library/review` body `{video_ids:string[],review_status:"todo"|"keep"|"skip"}` -> `{updated_count:number}`.
`POST /library/refresh` body `{video_ids:string[]}` -> Job; refresh only already saved videos and preserve notes/status/tags.
`GET /library/stats` -> `{saved_count:number,channel_count:number,playlist_count:number,category_count:number,todo_count:number,keep_count:number,skip_count:number}`.
`GET /library/groups?kind=channels|playlists|categories&page=1&page_size=24&q=...&channel_id=...` -> Page<Group>.
`Group={key:string,title:string,subtitle:string|null,video_count:number,unreviewed_count:number,thumbnail_url:string|null}`. Unknown channel key `unknown`, unknown category key `unknown`. Playlist groups derive only observed memberships, a video can have multiple. channel_id filter narrows playlists to known saved videos in that channel.

`GET /export.csv?scope=library|job&job_id=...&video_ids=id1,id2&group_kind=...&group_key=...&q=...&status=...&content_type=...` streams all matching records when no IDs; frontend passes active filters. CSV UTF-8 BOM, formula-safe text, 17 metadata groups flattened plus separate app review/source fields, no excluded fields. Limit explicit ID lists to1000; stream large exports in batches.

No fake data, no authentication/cookies, local-only by default. SQLite data lives `backend/data/tubescope.sqlite3` configurable by `TUBESCOPE_DB` for isolated tests.
