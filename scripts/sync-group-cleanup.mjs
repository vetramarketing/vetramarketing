import { readFile, writeFile } from 'node:fs/promises';

// Keep the copyable library entry and the standalone download byte-for-byte identical.
const code = await readFile(
  new URL('../public/console-scripts/facebook-remove-vetra-group-posts.js', import.meta.url),
  'utf8',
);
const output = new URL('../src/lib/provided-console-scripts.json', import.meta.url);
const previous = await readFile(output, 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
const previousCodes = [
  ...new Set([
    ...(previous?.previousCodes ?? []),
    ...(previous?.code && previous.code !== code ? [previous.code] : []),
  ]),
].filter((value) => value !== code);
const title = 'Facebook — Remove group posts';
const description = [
  'Open a Facebook group’s discussion or a member’s feed in that group on desktop. Copy this code into F12 → Console.',
  'Click Scan posts. Review the links and choose individual posts or Select all scanned posts. Type DELETE followed by the number selected, then click Start removal.',
  'The signed-in account needs Facebook permission for each selected post. The script stops if it cannot recognize a supported Delete post or Remove post action. If a custom group URL finds no posts, try its numeric group URL.',
  'Removal may be permanent. Keep the tab visible and use Stop to halt further actions. Download the manifest to review selected posts and results. The scan may be incomplete.',
  'เปิดหน้าการสนทนาของกลุ่ม Facebook หรือหน้ารวมโพสต์ของสมาชิกในกลุ่มบนเดสก์ท็อป วางโค้ดใน Console แล้วกด Scan posts ตรวจสอบและเลือกโพสต์ จากนั้นพิมพ์ DELETE ตามด้วยจำนวนที่เลือกแล้วกด Start removal บัญชีที่ใช้ต้องมีสิทธิ์ลบโพสต์ใน Facebook',
].join('\n\n');
const previousDetails =
  previous?.previousDetails ??
  (previous ? { title: previous.title, description: previous.description } : null);
const entry = {
  id: 'facebook-vetra-group-cleanup-197124767711219',
  companyId: '',
  title,
  platform: 'facebook',
  description,
  code,
  pinned: false,
  createdAt: '2026-11-07T00:00:00.000Z',
  updatedAt: '2026-11-07T00:00:00.000Z',
  previousCodes,
  previousDetails,
};
await writeFile(
  new URL('../src/lib/provided-console-scripts.json', import.meta.url),
  JSON.stringify(entry, null, 2) + '\n',
  'utf8',
);
console.log(`Updated cleanup library entry (${code.length} characters).`);
