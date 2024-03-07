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
const { asyncMap } = require("@saltcorn/data/utils");
const db = require("@saltcorn/data/db");
const {
  stateToQueryString,
  stateFieldsToWhere,
  link_view,
} = require("@saltcorn/data/plugin-helper");
const pluralize = require("pluralize");

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
                label: "Parent field",
                type: "String",
                sublabel: "Table must have a field that is Key to itself",
                required: true,
                attributes: {
                  options: parent_fields.map((f) => f.name).join(),
                },
              },
              {
                name: "order_field_parents",
                label: "Parents: Order by",
                sublabel: "",
                type: "String",
                required: true,
                attributes: {
                  options: fields.map((f) => f.name).join(),
                },
              },
              {
                name: "descending_parents",
                label: "Descending parents",
                type: "Bool",
                required: true,
              },
              {
                name: "order_field_children",
                label: "Children: Order by",
                sublabel: "",
                type: "String",
                required: true,
                attributes: {
                  options: fields.map((f) => f.name).join(),
                },
              },
              {
                name: "descending_children",
                label: "Descending children",
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
              {
                name: "top_create_display",
                label: "Display top-level create view as",
                type: "String",
                required: true,
                attributes: {
                  options: "Link,Embedded,Popup",
                },
              },
              {
                name: "tree_create_display",
                label: "Display in-tree create view as",
                type: "String",
                required: true,
                attributes: {
                  options: "Link,Embedded,Popup",
                },
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

const renderWithChildren = async ({ row, html }, opts, rows) => {
  const children = rows.filter(
    (node) => node.row[opts.parent_field] === row.id
  ).sort((a,b) => a.row[opts.order_field_parents] - b.row[opts.order_field_parents]);
  return div(
    html,
    opts.view_to_create &&
      (await create_display(
        opts.create_view,
        opts.create_display,
        opts.label_create,
        opts.role,
        opts.table,
        opts.state,
        opts.extraArgs,
        opts.parent_field,
        row
      )),
    div(
      { style: "margin-left: 20px" },
      await asyncMap(children, (node) => renderWithChildren(node, opts, rows))
    )
  );
};
const create_display = async (
  create_view,
  how,
  label_create,
  role,
  table,
  state0,
  extraOpts,
  parent_field,
  row
) => {
  const state = { ...state0 };
  if (parent_field) state[parent_field] = row.id;
  if (!create_view) return "";
  if (create_view && role <= table.min_role_write) {
    if (how === "Embedded") {
      return await create_view.run(state, extraOpts);
    } else {
      return link_view(
        `/view/${create_view.name}${stateToQueryString(state)}`,
        label_create || `Add ${pluralize(table.name, 1)}`,
        how === "Popup"
      );
    }
  }
};
const run = async (
  table_id,
  viewname,
  {
    show_view,
    parent_field,
    order_field_children,
    order_field_parents,
    descending,
    view_to_create,
    label_create,
    top_create_display,
    tree_create_display,
  },
  state,
  extraArgs
) => {
  const table = await Table.findOne({ id: table_id });
  const role =
    extraArgs && extraArgs.req && extraArgs.req.user
      ? extraArgs.req.user.role_id
      : 10;
  const showview = await View.findOne({ name: show_view });
  if (!showview)
    return div(
      { class: "alert alert-danger" },
      "CommentTree incorrectly configured. Cannot find view: ",
      show_view
    );
  const renderedWithRows = await showview.runMany(state, extraArgs);

  let rootRows = renderedWithRows.filter(({ row }) => !row[parent_field]).sort((a,b) => a.row[order_field_children] - b.row[order_field_children]);;
  const create_view =
    view_to_create && (await View.findOne({ name: view_to_create }));
  return div(
    view_to_create &&
      (await create_display(
        create_view,
        top_create_display,
        label_create,
        role,
        table,
        state,
        extraArgs
      )),
    await asyncMap(rootRows, (row) =>
      renderWithChildren(
        row,
        {
          parent_field,
          order_field_parents,
          create_view,
          view_to_create,
          label_create,
          state,
          extraArgs,
          label_create,
          role,
          table,
          create_display: tree_create_display,
        },
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
