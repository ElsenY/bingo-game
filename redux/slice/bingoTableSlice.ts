import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { table } from "console";

// Define a type for the slice state
interface CounterState {
  table: { [key: string]: boolean };
  calledNum: Array<number>;
  isCalled: boolean;
  gameStarted: boolean;
}

// Define the initial state using that type
const initialState: CounterState = {
  table: {},
  calledNum: [],
  isCalled: false,
  gameStarted: false,
};

export const bingoTableSlice = createSlice({
  name: "counter",
  // `createSlice` will infer the state type from the `initialState` argument
  initialState,
  reducers: {
    // to check which number has been called
    initTable: (state, action) => {
      state.table = action.payload.table;
    },
    callNum: (state, action) => {
      state.table[action.payload.num] = true;
      if (!state.calledNum.includes(action.payload.num)) {
        state.calledNum.push(action.payload.num);
        state.isCalled = false;

        localStorage.setItem("calledNums", JSON.stringify(state.calledNum));
      } else {
        state.isCalled = true;
      }
    },
    startGame: (state, action) => {
      state.gameStarted = true;
    },
  },
});

export const { initTable, callNum, startGame } = bingoTableSlice.actions;

// Other code such as selectors can use the imported `RootState` type

export default bingoTableSlice.reducer;
