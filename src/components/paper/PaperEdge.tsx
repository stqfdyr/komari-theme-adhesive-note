// 这两个 id 由 paper.css 以 url(#...) 引用，改名要同时改那两处
const FLAG_WAVE_ID = "km-flag-wave";
const SHEET_OFFLINE_ID = "km-sheet-offline";

/**
 * 全应用挂载一次的 SVG 滤镜定义。
 *
 * 每张卡片各带一份的话，滤镜定义会随节点数线性增长。
 */
export function PaperEdgeDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <defs>
        {/*
          离线卡片的纸：压淡投影，纸面不动。

          素材的投影烘在 alpha 里，改不了颜色；整体 opacity 也不行——纸与墙的
          对比本来只有 2.5%，纸面跟着一淡就从墙上消失了。gamma 只弯曲 alpha 的
          中段，投影带被压到约六成，而纸面的 1.0 是 gamma 的不动点。

          `color-interpolation-filters="sRGB"` 不能省：SVG 滤镜默认在 linearRGB
          里运算，这个 url() 一旦出现在 filter 链首，整条链都会跟进去，后面接的
          CSS 简写滤镜函数（brightness / saturate / sepia）就全部走样。
        */}
        <filter
          id={SHEET_OFFLINE_ID}
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feComponentTransfer>
            <feFuncA type="gamma" exponent="1.5" amplitude="1" offset="0" />
          </feComponentTransfer>
        </filter>

        {/* 国旗波浪：把 Twemoji 的平面旗面吹成一面飘着的小旗 */}
        <filter
          id={FLAG_WAVE_ID}
          x="-12%"
          y="-22%"
          width="124%"
          height="144%"
          filterUnits="objectBoundingBox"
        >
          {/*
            纵向频率压到近乎为零：噪声只随 x 变化、沿 y 恒定，整列一起上下移动，
            旗面才是一整片在飘。y 上也有噪声的话，同一根条纹的上下沿各走各的，
            星条旗会被剪成一段一段。
          */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.03 0.0006"
            numOctaves="1"
            seed="19"
            result="wave"
          />
          {/* R 通道钉死在 0.5（即位移 0），只留 G 通道驱动纵向位移 */}
          <feColorMatrix
            in="wave"
            type="matrix"
            values="0 0 0 0 0.5  0 1 0 0 0  0 0 0 0 0.5  0 0 0 0 1"
            result="wave-y"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="wave-y"
            scale="7"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
