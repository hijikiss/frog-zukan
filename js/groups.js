/**
 * 生き物グループの定義。アプリと scripts/build-species.mjs の両方が読む
 * 「語彙とサイズ帯の唯一の情報源」。
 *
 * タグのスキーマ（habitat / origin / size / activity / toxic / region / breeding / redlist）は
 * 全グループ共通。グループごとに変わるのは語彙・サイズ帯・呼び方だけなので、
 * species.js の検索・絞り込み・並び替えはグループを意識せず動く。
 *
 * DOM に触れないこと（Node から import するため）。アイコンは js/icons.js。
 */

/* ---------------- 共通の語彙 ---------------- */

export const ORIGINS = ['在来', '外来', '国外'];
export const SIZES = ['超小型', '小型', '中型', '大型', '超大型'];
export const ACTIVITIES = ['夜行性', '昼行性', '薄明薄暮性'];
export const REGIONS = [
  '日本', '東アジア', '東南アジア', '南アジア', '中央アジア', '西アジア', 'ヨーロッパ',
  'アフリカ', 'マダガスカル', '北アメリカ', '中央アメリカ', '南アメリカ', 'オセアニア', 'カリブ',
];
export const REDLIST = [
  '絶滅(EX)', '野生絶滅(EW)',
  '絶滅危惧IA類(CR)', '絶滅危惧IB類(EN)', '絶滅危惧II類(VU)',
  '準絶滅危惧(NT)', '低懸念(LC)', '情報不足(DD)', '評価対象外', 'ランク外',
];

// グループ別の生息環境。共通部分＋そのグループらしい選択肢。
const HAB_AMPHIBIAN = ['樹上棲', '地表棲', '地中棲', '水棲', '半水棲', '流水性'];
const HAB_SQUAMATE = ['樹上棲', '地表棲', '地中棲', '岩場棲', '砂漠棲', '水棲', '半水棲'];
const HAB_TURTLE = ['陸棲', '淡水棲', '汽水棲', '海棲', '半水棲'];
const HAB_CROC = ['淡水棲', '汽水棲', '半水棲'];

/* ---------------- グループ ---------------- */

/**
 * bands: [上限mm, 帯名] の並び。どれにも当たらなければ最後は「超大型」。
 * lengthLabel: 詳細画面の体長の行ラベル。グループで測り方が違う（甲長・全長・吻肛長）。
 * toxic: 毒の絞り込みを出すか（カメ・ワニ・ヤモリには不要）。
 */
export const GROUPS = [
  {
    id: 'frog',
    name: 'カエル',
    taxon: '無尾目',
    note: 'カエル・ヒキガエル・アマガエル',
    lengthLabel: '体長（吻肛長）',
    bands: [[25, '超小型'], [50, '小型'], [90, '中型'], [150, '大型']],
    habitats: HAB_AMPHIBIAN,
    toxic: { show: true, label: '毒あり（皮膚毒）' },
    breedingLabel: '繁殖期',
  },
  {
    id: 'newt',
    name: 'イモリ',
    taxon: '有尾目 イモリ科',
    note: 'アカハライモリ・ファイアサラマンダーなど',
    lengthLabel: '全長',
    bands: [[70, '超小型'], [110, '小型'], [160, '中型'], [250, '大型']],
    habitats: HAB_AMPHIBIAN,
    toxic: { show: true, label: '毒あり（皮膚毒）' },
    breedingLabel: '繁殖期',
  },
  {
    id: 'salamander',
    name: 'サンショウウオ',
    taxon: '有尾目（イモリ科以外）',
    note: 'オオサンショウウオ・ウーパールーパーなど',
    lengthLabel: '全長',
    bands: [[60, '超小型'], [120, '小型'], [250, '中型'], [600, '大型']],
    habitats: HAB_AMPHIBIAN,
    toxic: { show: true, label: '毒あり（皮膚毒）' },
    breedingLabel: '繁殖期',
  },
  {
    id: 'snake',
    name: 'ヘビ',
    taxon: '有鱗目 ヘビ亜目',
    note: 'アオダイショウ・ニシキヘビ・毒蛇',
    lengthLabel: '全長',
    bands: [[400, '超小型'], [800, '小型'], [1500, '中型'], [3000, '大型']],
    habitats: HAB_SQUAMATE,
    toxic: { show: true, label: '毒あり（有毒種）' },
    breedingLabel: '繁殖期',
  },
  {
    id: 'turtle',
    name: 'カメ',
    taxon: 'カメ目',
    note: 'イシガメ・リクガメ・ウミガメ',
    lengthLabel: '甲長',
    bands: [[120, '超小型'], [200, '小型'], [400, '中型'], [800, '大型']],
    habitats: HAB_TURTLE,
    toxic: { show: false, label: '' },
    breedingLabel: '産卵期',
  },
  {
    id: 'gecko',
    name: 'ヤモリ',
    taxon: '有鱗目 ヤモリ下目',
    note: 'ニホンヤモリ・レオパ・ヒルヤモリ',
    lengthLabel: '全長',
    bands: [[80, '超小型'], [120, '小型'], [200, '中型'], [350, '大型']],
    habitats: HAB_SQUAMATE,
    toxic: { show: false, label: '' },
    breedingLabel: '繁殖期',
  },
  {
    id: 'lizard',
    name: 'トカゲ',
    taxon: '有鱗目（ヘビ・ヤモリ以外）',
    note: 'カナヘビ・イグアナ・オオトカゲ・カメレオン',
    lengthLabel: '全長',
    bands: [[120, '超小型'], [250, '小型'], [500, '中型'], [1500, '大型']],
    habitats: HAB_SQUAMATE,
    toxic: { show: true, label: '毒あり' },
    breedingLabel: '繁殖期',
  },
  {
    id: 'croc',
    name: 'ワニ',
    taxon: 'ワニ目',
    note: '世界の全種',
    lengthLabel: '全長',
    bands: [[1500, '超小型'], [2500, '小型'], [4000, '中型'], [6000, '大型']],
    habitats: HAB_CROC,
    toxic: { show: false, label: '' },
    breedingLabel: '産卵期',
  },
];

export const GROUP_IDS = GROUPS.map((g) => g.id);

export const DEFAULT_GROUP = 'frog';

const map = new Map(GROUPS.map((g) => [g.id, g]));

/** 不明な id でもカエルの定義を返す（古いデータや壊れた URL で落ちないように） */
export const group = (id) => map.get(id) || map.get(DEFAULT_GROUP);

export const isGroup = (id) => map.has(id);

/** そのグループの species JSON の場所 */
export const dataFile = (id) => `./data/species/${id}.json`;

/** 体長の最大値から帯を決める。グループで基準が違う（ヘビの1mは中型、カエルなら超大型）。 */
export function sizeBand(maxMm, groupId) {
  const n = Number(maxMm);
  if (!Number.isFinite(n)) return '';
  for (const [limit, label] of group(groupId).bands) {
    if (n < limit) return label;
  }
  return '超大型';
}
