import { useEffect, useState } from "react";

import { getChartModalLayout } from "./chart-parts";
import type { ChartModalLayout } from "./chart-parts";

export function useChartModalLayout(): ChartModalLayout {
  const [modalLayout, setModalLayout] = useState<ChartModalLayout>(() => getChartModalLayout());

  useEffect(() => {
    const handleResize = () => {
      setModalLayout(getChartModalLayout());
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return modalLayout;
}
