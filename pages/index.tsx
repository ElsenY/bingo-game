import type { NextPage } from "next";
import Head from "next/head";
import styles from "../styles/Home.module.css";
import Table from "components/organism/table";
import SubmitNumForm from "components/molecules/submitNumForm";
import { startGame } from "redux/slice/bingoTableSlice";
import { initTable } from "redux/slice/bingoTableSlice";
import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";

const Home: NextPage = () => {
  const TABLE_SIZE = 5;
  const dispatch = useDispatch();

  useEffect(() => {
    let table: any = {};

    for (let i = 0; i < TABLE_SIZE * TABLE_SIZE; i++) {
      table[i + ""] = false;
    }

    const payload = {
      table: table,
    };

    initTable(payload);
  }, []);

  return (
    <div className={styles.container}>
      <Head>
        <title>Bingo Game</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <div className="flex justify-center">
          <h1 className="">Welcome to Bingo Game!</h1>
        </div>
        <div className="flex space-x-4">
          <Table idx={0} SIZE={TABLE_SIZE} />
          <Table idx={1} SIZE={TABLE_SIZE} />
        </div>
        <br />
        <div className="flex space-x-4">
          <Table idx={2} SIZE={TABLE_SIZE} />
          <Table idx={3} SIZE={TABLE_SIZE} />
        </div>
        <br />
        <SubmitNumForm />
        <br />
        <br />
        <br />
        <button onClick={() => dispatch(startGame())}>START GAME</button>
      </main>
    </div>
  );
};

export default Home;
