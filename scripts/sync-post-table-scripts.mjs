import { readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';

// Keep the combined snippet self-contained while sharing the exact standalone scroll routine.
const scrollSource = await readFile(
  new URL('../public/console-scripts/facebook-post-table-fast-scroll.js', import.meta.url),
  'utf8',
);
const copyTemplate = await readFile(
  new URL('./templates/facebook-copy-post-table-html.js', import.meta.url),
  'utf8',
);
const scrollPlaceholder = 'await scrollPostTable()';
if (copyTemplate.split(scrollPlaceholder).length !== 2)
  throw new Error('The copy template must contain exactly one scroll step.');
const prettierOptions = JSON.parse(
  await readFile(new URL('../.prettierrc.json', import.meta.url), 'utf8'),
);
const combinedSource = await format(
  copyTemplate.replace(scrollPlaceholder, () => `await ${scrollSource.trim().replace(/;$/, '')}`),
  { ...prettierOptions, parser: 'babel' },
);
await writeFile(
  new URL('../public/console-scripts/facebook-copy-post-table-html.js', import.meta.url),
  combinedSource,
  'utf8',
);

const entries = [
  {
    id: 'facebook-post-table-fast-scroll',
    output: 'provided-post-table-scroll-script.json',
    title: 'Facebook — Very fast post table scroll',
    description: [
      'EN: Open the Meta/Facebook Content library post data table in English or Thai. Paste this script into F12 → Console. It first activates Viewers (ผู้ชม) sorting from highest to lowest and waits for the table to refresh. Each run returns to the top so scrolling also works when a previous run left the table at the bottom. It then scrolls the table’s panel quickly every 100ms, preserving horizontal position and visiting intermediate rows so Facebook can load more. At the bottom it retries with a small up/down movement. It stops after 8 quiet seconds at the bottom, after loading stalls for 30 seconds, or after 10 minutes.',
      'Stop: press Esc while the page is focused, or run stopPostTableScroll() in the Console. After scrolling stops, run “Copy post table outerHTML”. Only markup still present in the page can be copied; Meta may remove earlier rows during scrolling, so this does not guarantee all posts are included.',
      'TH: เปิดตารางข้อมูลโพสต์ในคลังเนื้อหาของ Meta/Facebook (ภาษาไทยหรืออังกฤษ) แล้ววางสคริปต์ใน F12 → Console สคริปต์จะเรียงตามผู้ชมจากมากไปน้อยและรอให้ตารางโหลดใหม่ก่อน ทุกครั้งที่เรียกใช้จะกลับไปเริ่มจากด้านบน แม้ครั้งก่อนจะเลื่อนถึงด้านล่างแล้ว จากนั้นจะเลื่อนตารางอย่างรวดเร็วทุก 100 มิลลิวินาที โดยคงตำแหน่งแนวนอนเดิมและเลื่อนผ่านแถวระหว่างทางเพื่อให้ Facebook โหลดข้อมูลเพิ่ม เมื่อถึงด้านล่างจะขยับขึ้นลงเล็กน้อยเพื่อลองโหลดต่อ และหยุดเมื่อไม่มีความคืบหน้าที่ด้านล่างเป็นเวลา 8 วินาที เมื่อการโหลดค้างนาน 30 วินาที หรือเมื่อทำงานครบ 10 นาที',
      'หยุดด้วย Esc ขณะโฟกัสอยู่ที่หน้าเว็บ หรือพิมพ์ stopPostTableScroll() ใน Console เมื่อหยุดเลื่อนแล้ว ให้ใช้สคริปต์ “Copy post table outerHTML” คัดลอกตาราง สคริปต์คัดลอกได้เฉพาะข้อมูลที่ยังอยู่ในหน้าเว็บเท่านั้น Meta อาจนำแถวก่อนหน้าออกระหว่างเลื่อน จึงไม่รับประกันว่าจะได้ครบทุกโพสต์',
    ].join('\n\n'),
  },
  {
    id: 'facebook-copy-post-table-html',
    output: 'provided-post-table-html-script.json',
    title: 'Facebook — Copy post table outerHTML',
    description: [
      'EN: Open the Meta/Facebook Content library post data table in English or Thai, then paste this script into F12 → Console. It runs “Very fast post table scroll” first: sorts Viewers (ผู้ชม) from highest to lowest, returns to the top, and scrolls quickly to load more rows. After 8 quiet seconds at the bottom, it automatically copies the table’s exact outerHTML, including its headers and currently rendered rows. If no vertical scrolling is available, it copies the current table after confirming the sort. Paste with Ctrl+V / Cmd+V.',
      'Cancel: press Esc while the page is focused, or run stopPostTableScroll() in the Console. Cancellation, missing or ambiguous tables, failed sorting, stalled loading, a replaced table, or the 10-minute limit leaves the clipboard unchanged. The script does not edit posts. This is a snapshot of the current table markup; unloaded rows and earlier rows removed by Meta’s virtualized table are not included.',
      'TH: เปิดตารางข้อมูลโพสต์ในคลังเนื้อหาของ Meta/Facebook (ภาษาไทยหรืออังกฤษ) แล้ววางสคริปต์นี้ใน F12 → Console สคริปต์จะทำงานตาม “Very fast post table scroll” ก่อน โดยเรียงตามผู้ชมจากมากไปน้อย กลับไปเริ่มจากด้านบน และเลื่อนอย่างรวดเร็วเพื่อโหลดแถวเพิ่ม เมื่อถึงด้านล่างและไม่มีความคืบหน้าเป็นเวลา 8 วินาที จะคัดลอก outerHTML ของตารางตามต้นฉบับโดยอัตโนมัติ รวมส่วนหัวและแถวที่ยังอยู่ในหน้าเว็บ หากไม่มีส่วนที่เลื่อนแนวตั้งได้ จะคัดลอกตารางปัจจุบันหลังยืนยันการเรียงแล้ว วางด้วย Ctrl+V / Cmd+V',
      'ยกเลิกด้วย Esc ขณะโฟกัสอยู่ที่หน้าเว็บ หรือพิมพ์ stopPostTableScroll() ใน Console หากยกเลิก ไม่พบตาราง พบหลายตาราง เรียงข้อมูลไม่สำเร็จ การโหลดค้าง ตารางถูกแทนที่ หรือทำงานครบ 10 นาที คลิปบอร์ดจะไม่เปลี่ยนแปลง สคริปต์ไม่แก้ไขโพสต์ ข้อมูลที่คัดลอกเป็นตารางในขณะนั้น ไม่รวมแถวที่ยังไม่ได้โหลดหรือแถวก่อนหน้าที่ Meta นำออกจากหน้าเว็บระหว่างเลื่อน',
    ].join('\n\n'),
  },
];

for (const { output, ...details } of entries) {
  const outputUrl = new URL(`../src/lib/${output}`, import.meta.url);
  const previous = await readFile(outputUrl, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  const code = await readFile(
    new URL(`../public/console-scripts/${details.id}.js`, import.meta.url),
    'utf8',
  );
  const changed =
    previous &&
    (previous.code !== code ||
      previous.title !== details.title ||
      previous.description !== details.description);
  const previousCodes = [
    ...new Set([
      ...(previous?.previousCodes ?? []),
      ...(previous?.code && previous.code !== code ? [previous.code] : []),
    ]),
  ].filter((value) => value !== code);
  const previousDetails = [
    ...new Map(
      [
        ...(previous?.previousDetails ?? []),
        ...(changed ? [{ title: previous.title, description: previous.description }] : []),
      ].map((value) => [JSON.stringify(value), value]),
    ).values(),
  ];
  const entry = {
    ...details,
    companyId: '',
    platform: 'facebook',
    code,
    pinned: false,
    createdAt: previous?.createdAt ?? '2026-11-08T00:00:00.000Z',
    updatedAt: changed
      ? new Date().toISOString()
      : (previous?.updatedAt ?? '2026-11-08T00:00:00.000Z'),
    previousCodes,
    previousDetails,
  };
  await writeFile(outputUrl, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  console.log(`Updated ${details.id} (${code.length} characters).`);
}
