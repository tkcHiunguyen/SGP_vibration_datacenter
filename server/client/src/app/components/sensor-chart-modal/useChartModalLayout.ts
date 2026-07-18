import { useEffect, useState, type RefObject } from "react";

import { getChartModalLayout } from "./chart-parts";
import type { ChartModalLayout } from "./chart-parts";

export function useChartModalLayout(containerRef?: RefObject<HTMLElement | null>): ChartModalLayout {
  const [modalLayout, setModalLayout] = useState<ChartModalLayout>(() => getChartModalLayout());

  useEffect(() => {
    const updateLayout = () => {
      const rect = containerRef?.current?.getBoundingClientRect();
      setModalLayout(getChartModalLayout(rect?.width, rect?.height));
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    const node = containerRef?.current;
    const observer = node && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateLayout)
      : null;
    if (node && observer) {
      observer.observe(node);
    }

    return () => {
      window.removeEventListener("resize", updateLayout);
      observer?.disconnect();
    };
  }, [containerRef]);

  return modalLayout;
}
