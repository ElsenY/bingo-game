import InvisCol from "components/molecules/invisCol";
import InvisBottomTop from "components/molecules/invisDiag/bottom-top";
import InvisDiag from "components/molecules/invisDiag/bottom-top";
import InvisTopBottom from "components/molecules/invisDiag/top-bottom";
import InvisRow from "components/molecules/invisRow";
import Row from "components/molecules/row";
import { ReactElement, Fragment, FC, useState, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { RootState } from "redux/store";

interface props {
  SIZE?: number;
  idx: number;
}

interface diagCalled {
  val: boolean;
  called: boolean;
}

export interface cell {
  number: number;
  called: boolean;
}

const Table: FC<props> = ({ SIZE = 5, idx }): ReactElement => {
  const gameStarted = useSelector(
    (state: RootState) => state.bingoTable.gameStarted
  );

  const [table, setTable] = useState<Array<Array<cell>>>(
    initRandomTable(false)
  );
  const [detectBingoRow, setDetectBingoRow] = useState(false);
  const [detectBingoCol, setDetectBingoCol] = useState(false);
  const [detectBingoTop, setDetectBingoTop] = useState<diagCalled>({
    val: false,
    called: false,
  });
  const [detectBingoBot, setDetectBingoBot] = useState<diagCalled>({
    val: false,
    called: false,
  });
  const [hideRandomize, setHideRandomize] = useState(false);
  const calledRow = useRef(new Map<Number, Boolean>([]));
  const calledCol = useRef(new Map<Number, Boolean>([]));

  function handleCalledChange(x: number, y: number) {
    setTable((state: Array<Array<cell>>) => {
      const newState = [...state];
      newState[y][x].called = true;
      return newState;
    });
  }

  function initRandomTable(initRandom: boolean) {
    let bingoTables = localStorage.getItem("bingoTables");
    let bingoTablesObj;
    if (bingoTables && !initRandom) {
      bingoTablesObj = JSON.parse(bingoTables);
      return bingoTablesObj[idx];
    }

    let arr: Array<Array<cell>> = [];
    let holderArr = [];
    for (var i = 0; i < SIZE * SIZE; i++) {
      holderArr.push(i);
    }

    for (let i = 0; i < SIZE; i++) {
      arr.push([]);
      for (let j = 0; j < SIZE; j++) {
        const pos = Math.random() * holderArr.length;
        const val = holderArr.splice(pos, 1)[0];
        const initCell: cell = {
          number: val + 1,
          called: false,
        };
        arr[i].push(initCell);
      }
    }

    if (bingoTables) {
      bingoTablesObj = JSON.parse(bingoTables);
    }

    const bingoTablesModif = { ...bingoTablesObj, [idx]: arr };
    localStorage.setItem("bingoTables", JSON.stringify(bingoTablesModif));
    setTable(arr);
    return arr;
  }

  function handleSetTable(val: number, x: number, y: number) {
    setTable((state: Array<Array<cell>>) => {
      const newState = [...state];
      newState[y][x].number = val;
      return newState;
    });
  }

  function Rows(): JSX.Element {
    const rows = [];
    for (let i = 0; i < SIZE; i++) {
      rows.push(
        <Row
          key={`row-${i}`}
          pos={i}
          handleSetTable={handleSetTable}
          handleCalledChange={handleCalledChange}
          table={table}
        />
      );
    }

    return <Fragment>{rows}</Fragment>;
  }

  function InvisCols(): JSX.Element {
    const columns = [];
    for (let i = 0; i < SIZE; i++) {
      const left = (i / SIZE) * 100 + "%";
      let allCellCalled = true;

      if (!calledCol.current.get(i)) {
        for (let j = 0; j < SIZE; j++) {
          if (!table[j][i].called) {
            allCellCalled = false;
          }
        }

        if (allCellCalled) {
          calledCol.current.set(i, true);
          setDetectBingoCol(true);
        }
      }

      columns.push(
        <InvisCol
          key={`invis-col-${i}`}
          left={left}
          allCellCalled={allCellCalled}
        />
      );
    }

    return <Fragment>{columns}</Fragment>;
  }

  function InvisRows(): JSX.Element {
    const invisRows = [];
    for (let i = 0; i < SIZE; i++) {
      const top = (i / SIZE) * 100 + "%";
      let allCellCalled = true;

      if (!calledRow.current.get(i)) {
        for (let j = 0; j < table[i].length; j++) {
          if (!table[i][j].called) {
            allCellCalled = false;
          }
        }

        if (allCellCalled) {
          calledRow.current.set(i, true);
          setDetectBingoRow(true);
        }
      }

      invisRows.push(
        <InvisRow
          key={`invis-col-${i}`}
          top={top}
          allCellCalled={allCellCalled}
        />
      );
    }

    return <Fragment>{invisRows}</Fragment>;
  }

  function BingoTopBottom(): JSX.Element {
    for (let i = 0; i < SIZE; i++) {
      if (!table[i][i].called) {
        return <></>;
      }
    }

    if (!detectBingoTop.called) {
      setDetectBingoTop({ val: true, called: true });
    }

    return <InvisTopBottom />;
  }

  function BingoBottomTop(): JSX.Element {
    for (let i = 0; i < SIZE; i++) {
      if (!table[i][SIZE - i - 1].called) {
        return <></>;
      }
    }

    if (!detectBingoBot.called) {
      setDetectBingoBot({ val: true, called: true });
    }

    return <InvisBottomTop />;
  }

  return (
    <div className="w-full">
      {detectBingoRow && (
        <h2 className="text-green-500 font-extrabold">BINGO ROW</h2>
      )}
      {detectBingoCol && (
        <h2 className="text-green-500 font-extrabold">BINGO COL</h2>
      )}
      {detectBingoTop.val && (
        <h2 className="text-green-500 font-extrabold">BINGO DIAG TOP</h2>
      )}
      {detectBingoBot.val && (
        <h2 className="text-green-500 font-extrabold">BINGO DIAG BOT</h2>
      )}
      <div className="w-full relative">
        <BingoBottomTop />
        <BingoTopBottom />
        <Rows />
        <InvisCols />
        <InvisRows />
      </div>
      <div className="flex float-left">
        <button
          onClick={() => {
            setDetectBingoRow(false);
            setDetectBingoCol(false);
            setDetectBingoTop({ ...detectBingoTop, val: false });
            setDetectBingoBot({ ...detectBingoBot, val: false });
          }}
        >
          RESET BINGO
        </button>
      </div>
      {!gameStarted && (
        <div className="flex space-x-4 float-right">
          {hideRandomize ? (
            <></>
          ) : (
            <button onClick={() => initRandomTable(true)}>RANDOMIZE</button>
          )}
          <button
            onClick={() => setHideRandomize(hideRandomize ? false : true)}
          >
            {hideRandomize ? "SHOW" : "HIDE"}
          </button>
        </div>
      )}
    </div>
  );
};

export default Table;
