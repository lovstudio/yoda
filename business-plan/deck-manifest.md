# Yoda BP Deck Manifest

Updated: 2026-07-26  
Status: ready

## Narrative

- Source of truth: `outline.md`
- Evidence source: `evidence-ledger.md`
- Prior accepted visual system: `../slide-deck/yoda-business-plan/`
- Audience: 中国早期科技投资人、AI 创业赛事评委
- Language: zh-CN
- Slides: 15
- Presentation duration: 8–10 minutes

## Visual system

- Style: Clean corporate editorial with a product-keynote opening
- Canvas: 16:9, 1600 × 900
- Background: warm white `#F6F5F1`; alternate stone `#ECEBE6`
- Primary ink: `#111312`
- Brand accent: Yoda deep green `#173D2A`; highlight green `#5DC98F`
- Comparison: blue gray `#526A7A`; risk gray `#A9AAA5`
- Typography: system CJK sans; conclusion headlines 50–68 px; body 20–28 px; source notes 15 px
- Safe margin: 76–92 px
- Layout rule: one conclusion and one dominant proof per page; no stock-photo filler, gradients, fake dashboards or decorative card walls

## Assets

- Yoda logo: `../slide-deck/yoda-business-plan/assets/yoda-logo.svg`
- 手工川 logo: `../slide-deck/yoda-business-plan/assets/shougongchuan-logo.svg`
- Real Task screenshot: `../slide-deck/yoda-business-plan/assets/yoda-tasks.jpg`
- Real Feature screenshot: `../slide-deck/yoda-business-plan/assets/yoda-feature.jpg`
- Founder scene: embedded source asset used by `render-deck.mjs`
- Website QR: `../slide-deck/yoda-business-plan/assets/yoda-website-qr.png`
- Contact QR: `../slide-deck/yoda-business-plan/assets/personal-wechat-qr.png`

## Output naming

- Editable deck: `Yoda-BP-2026-07-v1.pptx`
- PDF: `Yoda-BP-2026-07-v1.pdf`
- Full-deck preview: `Yoda-BP-2026-07-v1-preview.png`
- Slide images: `slides/01-slide-cover.png` … `slides/15-slide-fundraise.png`

## Illustrative visuals

- Slides 3 and 8 use conceptual curves and must display “趋势示意 / 非统计预测”.
- Slide 10 contains management assumptions for SAM, price, and SOM; these remain labeled in the slide footnote and evidence ledger.
- Slide 11 is a qualitative market-position inference, not third-party self-positioning.

## Refresh scope

- Slide 1: human-outcome-first cover copy.
- Slide 9: update GitHub build/use data to 2026-07-26.
- Slide 14: update founder execution data to 2026-07-26.
- Slide 15: tighten the ask from category proof to repeatable-growth proof.
- All other pages retain the accepted narrative and visual system, with evidence IDs added in `outline.md`.

## Final render verification

- Rendered slide images: 15 / 15, all 1600 × 900.
- PPTX slide count: 15.
- PDF page count: 15; page size 1600 × 900 points.
- Full-deck preview: 1600 × 928 contact sheet.
- Visual review: every slide inspected at full rendered size; no clipped, overlapping, off-canvas, stretched, or broken-CJK elements remain.
- Slide 12 targeted fix: increased value-staircase block heights; free-tier label and description no longer overlap.
- Slide 15 targeted fix: final-slide QR codes enlarged to 190 px.
- Final-slide QR decode: `https://yoda.lovstudio.ai` and `https://u.wechat.com/MHEwaZ0tQ8WJPTfmL7zn-OU?s=4` both decoded from their final rendered regions.
- Quantitative charts: measured values trace to `evidence-ledger.md`; conceptual curves and management assumptions are labeled.
