export function errorOf(code: string, message?: string, cells?: { r: number; c: number }[]) {
  const defaults: Record<string, string> = {
    missing_reason: "放置和拆除都要写理由。",
    unknown_type: "没有这个建筑类型。",
    not_found: "找不到这一项。",
    out_of_bounds: "占地超出了棋盘。",
    disabled_cell: "占地踩到了禁用格。",
    occupied: "占地和已有建筑重叠。",
    empty_cell: "这个格子上没有建筑。",
    clipped: "这会切到已经放好的建筑，先拆除再改。",
    bad_shape: "形状只能是 1×1、2×1、1×2、2×2。",
    bad_cost: "造价要是非负整数。",
    bad_pct: "加成要是正数。",
    bad_name: "名称不能为空。",
    bad_size: "行列只能是 2 到 6。",
    bad_priorities: "优先级必须是四个目标的一个排列。",
    duplicate_save_name: "已经有这个名字的存档了。",
    invalid_import: "这不是一份有效的沙盘配置。",
    server_unavailable: "沙盘服务未启动。先在项目目录运行 npm run dev。",
    empty_name: "先写一个名称。",
  };
  return {
    code,
    message: message ?? defaults[code] ?? "没有完成。",
    ...(cells ? { cells } : {}),
  };
}
