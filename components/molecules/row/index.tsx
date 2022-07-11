import Cell from "components/atom/cell";
import { cell } from "components/organism/table";
import React, { ReactElement, useState, FC } from "react";

interface props {
  width?: number;
  pos: number;
  table: Array<Array<cell>>;
  handleSetTable: (val: number, x: number, y: number) => void;
  handleCalledChange: (x: number, y: number) => void;
}

const Row: FC<props> = ({
  width = 5,
  pos,
  handleSetTable,
  handleCalledChange,
  table,
}): ReactElement => {
  function Cells(): JSX.Element {
    const cells = [];
    for (let i = 0; i < width; i++) {
      const cell = (
        <div
          key={`cells-${i}`}
          className={`flex font-bold`}
          style={{
            width: `${100 / width}%`,
          }}
        >
          <Cell
            posY={pos}
            posX={i}
            handleSetTable={handleSetTable}
            handleCalledChange={handleCalledChange}
            table={table}
          />
        </div>
      );

      cells.push(cell);
    }

    return <div className="flex bg-transparent">{cells}</div>;
  }

  return <Cells />;
};

export default Row;
