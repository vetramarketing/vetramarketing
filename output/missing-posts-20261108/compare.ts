import { readFileSync, writeFileSync } from 'node:fs';
import { previewMetaViewersUpdate } from '../../src/lib/meta-viewers-import';
const source = readFileSync('C:/Users/poomt/.codex/attachments/1f1631f0-6f6c-4684-88aa-4e149b54e6e1/Pasted text.txt', 'utf8');
const w = JSON.parse(readFileSync('output/missing-posts-20261108/workspace-posts.json','utf8'));
w.destinations = [];
for (const mode of ['active','including-trash']) {
const data = mode === 'active' ? w : {...w,posts:w.posts.map((p:any)=>({...p,deletedAt:undefined}))};
const result=previewMetaViewersUpdate(source,data,{publicationYear:2026,capturedOn:'2026-11-08'});
writeFileSync(`output/missing-posts-20261108/preview-${mode}.json`,JSON.stringify(result,null,2));
console.log(mode,{sourceRows:result.sourceRows,changes:result.changes.length,unchanged:result.unchanged.length,issues:result.issues.length});
console.log(result.issues.map(r=>({row:r.row,label:r.label,viewers:r.viewers,reason:r.reason})));
}
