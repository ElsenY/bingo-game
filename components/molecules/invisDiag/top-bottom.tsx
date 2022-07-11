import { FC } from "react";

const InvisTopBottom: FC = () => {
  return (
    <div
      className="w-full h-full absolute -z-10"
      style={{
        background:
          "linear-gradient(to left bottom, transparent calc(50% - 5px), red calc(50% - 10px), red 50%, transparent 50%)",
      }}
    />
  );
};

export default InvisTopBottom;
