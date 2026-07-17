import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getAppDataDir, projectAssetDir } from './paths'
import type { StudioDatabase } from './database'

/** Seeds the first-run sample manga project (3 SVG pages) into an empty database. */
export function ensureSampleProject(db: StudioDatabase): void {
  if (db.listProjects().length > 0) {
    return
  }

  const project = db.createProject({
    title: '夏日邂逅的约定',
    mode: 'story',
    source: 'sample',
  })

  for (let index = 0; index < 3; index += 1) {
    const relativePath = path.join('projects', project.id, 'originals', `page-${index + 1}.svg`)
    const absolutePath = path.join(getAppDataDir(), relativePath)
    projectAssetDir(project.id, 'originals')
    writeFileSync(absolutePath, sampleMangaSvg(index), 'utf8')
    const asset = db.createAsset({
      projectId: project.id,
      kind: 'original',
      relativePath,
      mimeType: 'image/svg+xml',
      width: 1200,
      height: 1600,
    })
    db.createPage({
      projectId: project.id,
      index,
      originalAssetId: asset.id,
      width: 1200,
      height: 1600,
    })
  }

  if (!existsSync(path.join(getAppDataDir(), 'README.txt'))) {
    writeFileSync(path.join(getAppDataDir(), 'README.txt'), 'Pixiv-to-Manga Studio local project data.\n')
  }
}

function sampleMangaSvg(index: number): string {
  const variants = [
    ['夏天特别蓝。', '我们在车站遇见，一切都刚刚好。', '#f7fbff'],
    ['你也是去海边吗？', '嗯！好久没去了。', '#fffafa'],
    ['要一起去吗？', '好啊，那就出发吧！', '#fbfff7'],
  ][index]

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <defs>
    <pattern id="tone" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="#d8d8d8"/>
    </pattern>
  </defs>
  <rect width="1200" height="1600" fill="${variants[2]}"/>
  <rect x="60" y="60" width="1080" height="580" fill="url(#tone)" stroke="#111" stroke-width="8"/>
  <rect x="60" y="690" width="510" height="360" fill="#fff" stroke="#111" stroke-width="8"/>
  <rect x="630" y="690" width="510" height="360" fill="#fff" stroke="#111" stroke-width="8"/>
  <rect x="60" y="1100" width="1080" height="440" fill="#fff" stroke="#111" stroke-width="8"/>
  <path d="M120 530 C240 350 420 270 580 350 S880 460 1060 300" fill="none" stroke="#333" stroke-width="10"/>
  <circle cx="470" cy="430" r="115" fill="#f4f4f4" stroke="#111" stroke-width="6"/>
  <path d="M390 380 C460 300 560 330 575 430 C540 360 450 365 390 380Z" fill="#111"/>
  <path d="M460 545 L430 630 L530 630 L505 545Z" fill="#111"/>
  <circle cx="350" cy="850" r="85" fill="#f4f4f4" stroke="#111" stroke-width="6"/>
  <path d="M285 815 C340 760 425 785 435 865 C390 810 335 810 285 815Z" fill="#111"/>
  <circle cx="870" cy="840" r="88" fill="#f4f4f4" stroke="#111" stroke-width="6"/>
  <path d="M800 800 C875 730 950 775 955 855 C910 790 850 790 800 800Z" fill="#111"/>
  <path d="M390 1320 C520 1180 700 1180 840 1320" fill="none" stroke="#111" stroke-width="10"/>
  <circle cx="460" cy="1280" r="76" fill="#f4f4f4" stroke="#111" stroke-width="6"/>
  <circle cx="740" cy="1280" r="76" fill="#f4f4f4" stroke="#111" stroke-width="6"/>
  <rect x="84" y="96" width="132" height="322" rx="4" fill="#fff" stroke="#111" stroke-width="5"/>
  <text x="164" y="145" writing-mode="vertical-rl" font-family="serif" font-size="38" font-weight="700" fill="#111">${variants[0]}</text>
  <ellipse cx="1000" cy="360" rx="92" ry="150" fill="#fff" stroke="#111" stroke-width="5"/>
  <text x="1030" y="245" writing-mode="vertical-rl" font-family="serif" font-size="34" font-weight="700" fill="#111">${variants[1]}</text>
</svg>`
}
