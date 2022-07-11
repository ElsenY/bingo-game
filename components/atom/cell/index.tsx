import { ReactElement, useState, FC, useEffect, ChangeEvent } from "react";
import { RootState } from "redux/store";
import { useSelector } from "react-redux";
import { cell } from "components/organism/table";

interface props {
  posX: number;
  posY: number;
  table: Array<Array<cell>>;
  handleSetTable: (val: number, x: number, y: number) => void;
  handleCalledChange: (x: number, y: number) => void;
}

const Cell: FC<props> = ({
  posX,
  posY,
  handleSetTable,
  handleCalledChange,
  table,
}): ReactElement => {
  // const [called, setCalled] = useState(false);

  const calledNum = useSelector(
    (state: RootState) => state.bingoTable.calledNum
  );

  const isCalled = useSelector((state: RootState) => state.bingoTable.isCalled);

  useEffect(() => {
    if (
      calledNum[calledNum.length - 1] === table[posY][posX].number &&
      !table[posY][posX].called
    ) {
      handleCalledChange(posX, posY);
    }
  }, [calledNum]);

  // useEffect(() => {
  //   if (calledNum[calledNum.length - 1] === table[posY][posX].number) {
  //     setCalled(true);
  //   }
  // }, [calledNum]);

  // useEffect(() => {
  //   setCalled(false);
  // }, [table[posY][posX]]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    let val = parseInt(e.target.value);
    if (!val) {
      val = 0;
    }
    handleSetTable(val, posX, posY);
  }

  return (
    <input
      type="text"
      value={table[posY][posX].number}
      className={`w-0 flex-auto ${
        table[posY][posX].called && "text-green-500"
      } text-center border-2 border-black bg-transparent`}
      onChange={(e) => handleChange(e)}
    />
  );
};

export default Cell;
