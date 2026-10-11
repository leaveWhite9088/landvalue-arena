export function errorOf(code: string, message?: string, cells?: { board?: number; r: number; c: number }[]) {
  const defaults: Record<string, string> = {
    missing_reason: "放置、拆除和交卷都要写一小段理由。",
    missing_round: "每次调用都要带这一局的编号 roundId。向开局的人要，不要猜。",
    unknown_round: "没有这一局。使用开局时给你的编号，不要猜。",
    round_closed: "这一局已经结束，不能再放置或拆除。",
    unknown_type: "没有这个建筑类型。",
    unknown_board: "没有这块棋盘。编号从 1 计，先看地图里的 boards。",
    too_many_boards: "最多 4 块棋盘。",
    last_board: "至少留一块棋盘。",
    not_found: "找不到这一项。",
    out_of_bounds: "占地超出了这块棋盘。",
    disabled_cell: "占地踩到了禁用格。",
    occupied: "占地和已有建筑重叠。",
    empty_cell: "这个格子上没有建筑。",
    clipped: "这会切到已经放好的建筑，先拆除再改。",
    bad_shape: "形状只能是 1×1、2×1、1×2、2×2。",
    bad_cost: "造价要是非负整数。",
    bad_pct: "加成要是正数。",
    bad_name: "名称不能为空。",
    bad_size: "每块棋盘的行和列只能是 2 到 6。",
    bad_priorities: "优先级必须是四个目标的一个排列。",
    duplicate_save_name: "已经有这个名字的存档了。",
    invalid_import: "这不是一份有效的沙盘配置。",
    server_unavailable: "沙盘服务未启动。先在项目目录运行 npm run dev。",
    empty_name: "先写一个名称。",
    unknown_model: "先选一个模型。",
  };
  return {
    code,
    message: message ?? defaults[code] ?? "没有完成。",
    ...(cells ? { cells } : {}),
  };
}
