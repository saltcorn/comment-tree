const {
  input,
  div,
  a,
  text,
  script,
  domReady,
  style,
  button,
} = require("@saltcorn/markup/tags");
const View = require("@saltcorn/data/models/view");
const Workflow = require("@saltcorn/data/models/workflow");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const Field = require("@saltcorn/data/models/field");
const db = require("@saltcorn/data/db");
const { stateFieldsToWhere } = require("@saltcorn/data/plugin-helper");

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "views",
        form: async (context) => {
          const table = await Table.findOne({ id: context.table_id });
          const fields = await table.getFields();
          const show_views = await View.find_table_views_where(
            context.table_id,
            ({ state_fields, viewtemplate, viewrow }) =>
              viewtemplate.renderRows &&
              viewrow.name !== context.viewname &&
              state_fields.some((sf) => sf.name === "id")
          );
          const show_view_opts = show_views.map((v) => v.name);
          const parent_fields = fields.filter(
            (f) => f.type === "Key" && f.reftable_name === table.name
          );
          const create_views = await View.find_table_views_where(
            context.table_id,
            ({ state_fields, viewrow }) =>
              viewrow.name !== context.viewname &&
              state_fields.every((sf) => !sf.required)
          );
          const create_view_opts = create_views.map((v) => v.name);
          fields.push({ name: "id" });
          return new Form({
            fields: [
              {
                name: "show_view",
                label: "Item View",
                type: "String",
                required: true,
                attributes: {
                  options: show_view_opts.join(),
                },
              },
              {
                name: "parent_field",
                label: "Item View",
                type: "String",
                sublabel: "Table must have a field that is Key to itself",
                required: true,
                attributes: {
                  options: parent_fields.map((f) => f.name).join(),
                },
              },
              {
                name: "order_field",
                label: "Order by",
                sublabel: "When parent is the same",
                type: "String",
                required: true,
                attributes: {
                  options: fields.map((f) => f.name).join(),
                },
              },
              {
                name: "descending",
                label: "Descending",
                type: "Bool",
                required: true,
              },
              {
                name: "view_to_create",
                label: "Use view to create",
                sublabel:
                  "If user has write permission. Leave blank to have no link to create a new item",
                type: "String",
                attributes: {
                  options: create_view_opts.join(),
                },
              },
              {
                name: "label_create",
                label: "Label to create",
                type: "String",
              },
            ],
          });
        },
      },
    ],
  });

const get_state_fields = async (table_id, viewname, { show_view }) => {
  const table_fields = await Field.find({ table_id });
  return table_fields.map((f) => {
    const sf = new Field(f);
    sf.required = false;
    return sf;
  });
};

const mkStateQS = (state) =>
  Object.entries(state)
    .map(([k, v]) =>
      k[0] === "_" ? "" : `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    )
    .join("");

const renderWithChildren = ({ row, html }, opts, rows) => {
  const children = rows.filter(
    (node) => node.row[opts.parent_field] === row.id
  );
  return div(
    html,
    opts.view_to_create &&
      a(
        {
          href: `/view/${opts.view_to_create}?${opts.parent_field}=${
            row.id
          }${mkStateQS(opts.state)}`,
        },
        opts.label_create
      ),
    div(
      { style: "margin-left: 20px" },
      children.map((node) => renderWithChildren(node, opts, rows))
    )
  );
};

const run = async (
  table_id,
  viewname,
  {
    show_view,
    parent_field,
    order_field,
    descending,
    view_to_create,
    label_create,
  },
  state,
  extraArgs
) => {
  const tbl = await Table.findOne({ id: table_id });
  const fields = await tbl.getFields();
  const qstate = await stateFieldsToWhere({ fields, state });

  const rows = await tbl.getRows(qstate, {
    orderBy: order_field,
    ...(descending && { orderDesc: true }),
  });

  const showview = await View.findOne({ name: show_view });
  const rendered = await showview.viewtemplateObj.renderRows(
    tbl,
    showview.name,
    showview.configuration,
    extraArgs,
    rows
  );

  const renderedWithRows = rendered.map((html, ix) => ({
    html,
    row: rows[ix],
  }));
  const rootRows = renderedWithRows.filter(({ row }) => !row[parent_field]);
  return div(
    view_to_create &&
      a(
        {
          href: `/view/${view_to_create}?${mkStateQS(state)}`,
        },
        label_create
      ),
    rootRows.map((row) =>
      renderWithChildren(
        row,
        { parent_field, view_to_create, label_create, state },
        renderedWithRows
      )
    )
  );
};

module.exports = {
  sc_plugin_api_version: 1,
  viewtemplates: [
    {
      name: "CommentTree",
      display_state_form: false,
      get_state_fields,
      configuration_workflow,
      run,
    },
  ],
};
