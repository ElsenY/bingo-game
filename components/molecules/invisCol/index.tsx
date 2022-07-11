import { ReactElement, useState, FC } from "react";

interface props {
  width?: number;
  left: string;
  allCellCalled: boolean;
}

const InvisCol: FC<props> = ({
  width = 5,
  left,
  allCellCalled,
}): ReactElement => {
  return (
    <div
      className={`absolute h-full top-0 -z-10`}
      style={{ left: left, width: `${100 / width}%` }}
    >
      <div
        className="h-full"
        style={{
          borderLeft: allCellCalled ? "4px solid red" : "",
          marginLeft: "50%",
        }}
      ></div>
    </div>
  );
};

export default InvisCol;
