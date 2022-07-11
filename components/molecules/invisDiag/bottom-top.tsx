import { FC } from "react";

const InvisBottomTop: FC = () => {
  return (
    <div
      className="w-full h-full absolute -z-10"
      style={{
        background:
          "linear-gradient(to right bottom, transparent calc(50% - 5px), red calc(50% - 10px), red 50%, transparent 50%)",
      }}
    />
  );
};

export default InvisBottomTop;
