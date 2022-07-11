import { cell } from "components/organism/table";
import { ReactElement, useState, FC, useEffect } from "react";

interface props {
  height?: number;
  top: string;
  allCellCalled: boolean;
}

const InvisRow: FC<props> = ({
  height = 5,
  top,
  allCellCalled,
}): ReactElement => {
  if (allCellCalled) {
    console.log("ASKDASKDAs", allCellCalled);
  }
  // const allCellCalled = () => {
  //   for (let i = 0; i < row.length; i++) {
  //     if (!row[i].called) {
  //       return false;
  //     }
  //   }

  //   return true;
  // };

  return (
    <div
      className={`absolute w-full  left-0 -z-10`}
      style={{ top: top, height: `${100 / height}%` }}
    >
      <div
        className="h-full relative top-1/2"
        style={{
          borderTop: `${allCellCalled ? "4px solid red" : "none"}`,
        }}
      />
    </div>
  );
};

export default InvisRow;
