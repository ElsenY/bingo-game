import React, { ReactElement, useState, FC } from "react";
import { useDispatch, useSelector } from "react-redux";
import { callNum } from "redux/slice/bingoTableSlice";
import { RootState } from "redux/store";

const SubmitNumForm: FC = (): ReactElement => {
  const [inputtedNum, setInputtedNum] = useState(-1);
  const [submitted, setSubmitted] = useState(false);
  const dispatch = useDispatch();

  const isCalled = useSelector((state: RootState) => state.bingoTable.isCalled);

  function submitInputNum(num: number) {
    const payload = {
      num,
    };
    dispatch(callNum(payload));
  }

  return (
    <div>
      <label>input submitted number : </label>
      <input
        className="border-black border-2"
        type="number"
        value={inputtedNum}
        onChange={(e) => setInputtedNum(parseInt(e.target.value))}
      ></input>
      <br />
      {submitted && (
        <div className="text-green-500">
          {isCalled ? "NUMBER HAS BEEN CALLED!" : "SUCCESS SUBMIT!"}
        </div>
      )}
      <div>
        <button
          onClick={() => {
            submitInputNum(inputtedNum);
            setSubmitted(true);
          }}
          className="bg-black text-white rounded-md p-1"
        >
          SUBMIT
        </button>
      </div>
    </div>
  );
};

export default SubmitNumForm;
