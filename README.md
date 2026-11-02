# Molecule

分子式・慣用名（和名）・IUPAC 名・SMILES から、または原子を自分で組み合わせて、分子の立体構造を 3D で表示する Web アプリです。

**公開ページ:** https://401t.github.io/molecule/

## できること

- **検索** — 分子式（`C6H12`、`CH3COOH`）、和名（`カフェイン`）、英名・IUPAC 名、SMILES、PubChem CID。分子式では異性体の候補を一覧表示します。
- **正確な立体構造** — PubChem の 3D 配座（MMFF94s で最適化された計算構造）の全原子座標をそのまま描画します。3D 配座が無い化合物は OpenChemLib で生成し、MMFF94s で最適化します。
- **原子名・不斉中心** — 球の上に原子名（C1、H12 …）、不斉中心に「*」と R/S を表示。キラル・アキラル・メソ体を判定します。
- **対称性と平面の作図** — 任意の原子で平面を作図し、鏡映面かどうかを判定。鏡映面と対称心の自動検出、結合の回転（二面角の設定）。
- **配座** — 六員環を Cremer–Pople パラメータで解析（椅子形・舟形・ねじれ舟形）。環反転・配座探索・MMFF94s によるエネルギー。
- **分子の作成** — 原子の追加・結合・置換・削除、水素の自動補完、元に戻す／やり直す。原子価を超える結合も受け付け、警告を表示します。
- **表示の調整** — 球（ファンデルワールス半径の倍率）・棒の太さ・ラベルの大きさをスライダーと数値で指定。ライト／ダーク対応。

## 使用しているもの

| 用途 | ライブラリ・データ |
| --- | --- |
| 3D 描画 | [3Dmol.js](https://3dmol.csb.pitt.edu/)（BSD-3-Clause） |
| 立体化学・配座生成・MMFF94s | [OpenChemLib JS](https://github.com/cheminfo/openchemlib-js)（BSD-3-Clause） |
| 構造データ | [PubChem](https://pubchem.ncbi.nlm.nih.gov/)（NCBI） |
| 和名検索 | [Wikidata](https://www.wikidata.org/)（CC0） |

ビルド手順はありません。静的ファイルだけで動きます。手元で確認するときは次を実行し、`http://localhost:8765` を開いてください。

```bash
python3 -m http.server 8765
```
