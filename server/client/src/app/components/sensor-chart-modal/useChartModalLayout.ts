import { useEffect, useState, type RefObject } from "react";

import { getChartModalLayout } from "./chart-parts";
import type { ChartModalLayout } from "./chart-parts";
import { useDisplayMode } from "../../context/DisplayModeContext";

export function useChartModalLayout(
  containerRef?: RefObject<HTMLElement | null>,
  bodyRef?: RefObject<HTMLElement | null>,
): ChartModalLayout {
  const { wallboard } = useDisplayMode();
  const [modalLayout, setModalLayout] = useState<ChartModalLayout>(() => getChartModalLayout(undefined, undefined, wallboard));

  useEffect(() => {
    const updateLayout = () => {
      const containerRect = containerRef?.current?.getBoundingClientRect();
      const bodyRect = bodyRef?.current?.getBoundingClientRect();
      setModalLayout(getChartModalLayout(
        bodyRect?.width ?? containerRect?.width,
        bodyRect?.height ?? containerRect?.height,
        wallboard,
      ));
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    const containerNode = containerRef?.current;
    const bodyNode = bodyRef?.current;
    const observer = (containerNode || bodyNode) && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateLayout)
      : null;
    if (containerNode && observer) {
      observer.observe(containerNode);
    }
    if (bodyNode && observer) {
      observer.observe(bodyNode);
    }

    return () => {
      window.removeEventListener("resize", updateLayout);
      observer?.disconnect();
    };
  }, [bodyRef, containerRef, wallboard]);

  return modalLayout;
}
